import React, { useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import rpx from "@/utils/rpx";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import Loading from "@/components/base/loading";

import PluginManager, { useSortedPlugins } from "@/core/pluginManager";
import { trace } from "@/utils/log";

import Toast from "@/utils/toast";
import axios from "axios";
import { useNavigation } from "@react-navigation/native";
import Config from "@/core/appConfig";
import HorizontalSafeAreaView from "@/components/base/horizontalSafeAreaView.tsx";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import AppBar from "@/components/base/appBar";
import ThemeText from "@/components/base/themeText";
import { TouchableOpacity } from "react-native-gesture-handler";
import PluginItem from "../components/pluginItem";
import { IIconName } from "@/components/base/icon.tsx";
import { IInstallPluginResult } from "@/types/core/pluginManager";
import { useI18N } from "@/core/i18n";

interface IOption {
    icon: IIconName;
    title: string;
    onPress?: () => void;
}

/**
 * 空列表引导：插件列表为空时显示
 */
function EmptyPluginGuide({ onPress }: { onPress: () => void }) {
    return (
        <View style={style.emptyWrapper}>
            <TouchableOpacity
                hasTVPreferredFocus={true}
                onPress={onPress}
                style={style.emptyButton}>
                <ThemeText style={style.emptyButtonPlus}>＋</ThemeText>
            </TouchableOpacity>
            <ThemeText style={style.emptyTitle}>还没有插件</ThemeText>
            <ThemeText style={style.emptySubTitle}>点这里安装插件</ThemeText>
            <ThemeText style={style.emptyHint}>
                （也可以用遥控器按"上"选中右上角的"＋"）
            </ThemeText>
        </View>
    );
}

/**
 * 列表底部"添加更多插件"按钮
 */
function AddMoreFooter({ onPress }: { onPress: () => void }) {
    return (
        <TouchableOpacity onPress={onPress} style={style.addMoreButton}>
            <ThemeText style={style.addMoreText}>＋ 添加更多插件</ThemeText>
        </TouchableOpacity>
    );
}

// ==================== 核心修复：可真正中断的下载安装 ====================

const DOWNLOAD_TIMEOUT = 15000;
const MAX_RETRY = 3; // 每个插件最多尝试 3 次（首次 + 2 次重试）
const BATCH_SIZE = 3; // 两条安装路径都不进内部安装队列，并发 3 安全

// 统一的浏览器请求头，破解防盗链和 UA 拦截
const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Expires": "0",
};

/** 判断是否值得重试：404/403/内容无效属于源失效，重试也没用，直接放弃 */
function isRetryableError(msg: string): boolean {
    const m = (msg || "").toLowerCase();
    if (
        m.includes("404") ||
        m.includes("403") ||
        m.includes("无法解析") ||
        m.includes("无法识别") ||
        m.includes("内容为空") ||
        m.includes("html")
    ) {
        return false;
    }
    return true;
}

/**
 * 单插件下载 + 安装。
 *
 * 【架构说明】全程不调用 PluginManager.installPluginFromUrl：
 * 那条路内部会走网络安装队列，一旦内部请求挂死会永久占锁，
 * 后续所有安装全部排队等待（最初"卡在 4/57"的病根）。
 *
 * 下载：axios + AbortController，超时能真正中断请求（带浏览器头防拦截）；
 * 安装：优先 installPluginFromScript（从代码直装），
 *      否则写临时文件走 installPluginFromLocalFile（本地安装路径，无网络依赖）。
 */
async function downloadAndInstallPlugin(
    url: string,
): Promise<IInstallPluginResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
    let tmpUri: string | null = null;

    try {
        const response = await axios.get(url, {
            timeout: DOWNLOAD_TIMEOUT,
            signal: controller.signal,
            responseType: "text",
            transformResponse: [data => data],
            headers: {
                ...BROWSER_HEADERS,
                "Referer": url,
            },
        });

        const code = response.data;
        if (typeof code !== "string" || code.trim().length === 0) {
            return {
                success: false,
                message: "下载内容为空（源可能已失效）",
                pluginUrl: url,
            };
        }
        if (code.trim().startsWith("<")) {
            return {
                success: false,
                message: "返回内容是 HTML 而非 JS（源可能已失效）",
                pluginUrl: url,
            };
        }

        const pm: any = PluginManager as any;
        const notCheckVersion = Config.getConfig("basic.notCheckPluginVersion");

        // 路径 A（首选）：installPluginFromScript —— 从代码字符串直接安装
        if (typeof pm.installPluginFromScript === "function") {
            const r = await pm.installPluginFromScript(code, {
                notCheckVersion,
            });
            if (r === undefined || r?.success) {
                return { success: true, message: "", pluginUrl: url };
            }
            return {
                success: false,
                message: r?.message ?? "插件校验失败",
                pluginUrl: url,
            };
        }

        // 路径 B（兜底）：写临时文件 → 本地安装（与"从本地安装插件"同路径）
        const safeName =
            "plugin_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".js";
        tmpUri = (FileSystem.cacheDirectory ?? "") + safeName;
        await FileSystem.writeAsStringAsync(tmpUri, code, {
            encoding: FileSystem.EncodingType.UTF8,
        });

        try {
            const r = await pm.installPluginFromLocalFile(tmpUri, {
                notCheckVersion,
                useExpoFs: true,
            });
            // undefined 视为成功，兼容返回 void 的版本
            if (r === undefined || r?.success) {
                return { success: true, message: "", pluginUrl: url };
            }
            return {
                success: false,
                message: r?.message ?? "本地安装失败",
                pluginUrl: url,
            };
        } finally {
            FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
        }
    } catch (e: any) {
        const aborted =
            e?.code === "ECONNABORTED" ||
            e?.name === "AbortError" ||
            e?.message === "canceled";
        trace("下载失败", url, "code:", e?.code, "msg:", e?.message);
        return {
            success: false,
            message: aborted
                ? `请求超时（${DOWNLOAD_TIMEOUT / 1000}秒）`
                : e?.message ?? String(e),
            pluginUrl: url,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * 单插件安装入口：最多 MAX_RETRY 次尝试，指数退避（1s → 2s）。
 * - 只有临时性错误（超时/断网）才重试，源失效直接放弃；
 * - 已安装相同 srcUrl 的插件视为成功，直接跳过；
 * - 重试文案带总进度。
 */
async function installOnePluginByUrl(
    url: string,
    onProgressText?: (txt: string) => void,
    shouldCancel?: () => boolean,
    currentIndex?: number,
    totalCount?: number,
): Promise<IInstallPluginResult> {
    try {
        const installed = PluginManager.getSortedPlugins?.() ?? [];
        if (installed.some(p => p.instance?.srcUrl === url)) {
            return { success: true, message: "已安装，跳过", pluginUrl: url };
        }
    } catch {
        /* API 不存在则忽略 */
    }

    let last: IInstallPluginResult | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        if (shouldCancel?.()) break;

        if (attempt > 1) {
            const progressStr =
                currentIndex !== undefined && totalCount !== undefined
                    ? ` · 第 ${currentIndex}/${totalCount} 个`
                    : "";
            onProgressText?.(`重试中 ${attempt - 1}/${MAX_RETRY - 1}${progressStr}…`);
            await new Promise(resolve =>
                setTimeout(resolve, 1000 * Math.pow(2, attempt - 2)),
            );
        }

        last = await downloadAndInstallPlugin(url);
        if (last.success) return last;

        if (!isRetryableError(last.message)) break;
    }

    return {
        ...(last ?? { success: false, message: "未知错误", pluginUrl: url }),
        pluginUrl: url,
    };
}

/**
 * 从 URL（或订阅 JSON）安装一批插件：并发 3 + allSettled，单点失败不拖累他人。
 */
async function installPluginFromUrl(
    text: string,
    onProgressText?: (txt: string) => void,
    shouldCancel?: () => boolean,
): Promise<IInstallPluginResult[]> {
    try {
        let urls: string[] = [];
        const inputUrl = text.trim();

        if (text.endsWith(".json")) {
            onProgressText?.("正在获取订阅 JSON...");
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20000);
            try {
                const jsonFile = (
                    await axios.get(inputUrl, {
                        timeout: 20000,
                        signal: controller.signal,
                        headers: BROWSER_HEADERS,
                    })
                ).data;
                urls = (jsonFile?.plugins ?? []).map((_: any) => _.url);
            } finally {
                clearTimeout(timer);
            }

            if (urls.length === 0) {
                return [{
                    success: false,
                    message: "订阅 JSON 中没有插件（plugins 为空）",
                    pluginUrl: inputUrl,
                }];
            }
        } else {
            urls = [inputUrl];
        }

        urls = Array.from(new Set(urls.filter(u => u && u.trim())));

        const results: IInstallPluginResult[] = [];
        let completed = 0;
        const total = urls.length;

        for (let i = 0; i < urls.length; i += BATCH_SIZE) {
            if (shouldCancel?.()) break;
            const batch = urls.slice(i, i + BATCH_SIZE);

            const batchResults = await Promise.allSettled(
                batch.map((u, index) =>
                    installOnePluginByUrl(
                        u,
                        onProgressText,
                        shouldCancel,
                        completed + index + 1,
                        total,
                    ),
                ),
            );

            for (let j = 0; j < batchResults.length; j++) {
                const res = batchResults[j];
                if (res.status === "fulfilled") {
                    results.push(res.value);
                } else {
                    results.push({
                        success: false,
                        message: (res.reason?.message || String(res.reason)) ?? "未知异常",
                        pluginUrl: batch[j],
                    });
                }
                completed++;
            }

            onProgressText?.(`正在安装插件 ${completed}/${total}`);
            await new Promise(resolve => setTimeout(resolve, 30));
        }

        return results;
    } catch (e: any) {
        return [{ success: false, message: e?.message, pluginUrl: text }];
    }
}

// ==================== 订阅同步辅助 ====================

function getSubscriptionState(): Record<string, string[]> {
    try {
        const raw: any = Config.getConfig("plugin.subscribeState" as any);
        if (!raw) return {};
        if (typeof raw === "string") {
            try {
                return JSON.parse(raw);
            } catch {
                return {};
            }
        }
        return raw;
    } catch {
        return {};
    }
}

function setSubscriptionState(state: Record<string, string[]>) {
    try {
        Config.setConfig("plugin.subscribeState" as any, state as any);
    } catch (e: any) {
        trace("保存订阅状态失败", e?.message);
    }
}

async function fetchSubscriptionPluginUrls(subUrl: string): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
        const jsonFile = (
            await axios.get(subUrl, {
                timeout: 20000,
                signal: controller.signal,
                headers: BROWSER_HEADERS,
            })
        ).data;
        const urls: string[] = (jsonFile?.plugins ?? [])
            .map((_: any) => _.url)
            .filter((u: any) => u && String(u).trim());
        return Array.from(new Set(urls));
    } finally {
        clearTimeout(timer);
    }
}

async function uninstallPluginBySrcUrl(srcUrl: string): Promise<boolean> {
    try {
        const plugins = PluginManager.getSortedPlugins();
        const target = plugins.find(p => p.instance?.srcUrl === srcUrl);
        if (target) {
            await PluginManager.uninstallPlugin(target.hash);
            return true;
        }
    } catch (e: any) {
        trace("卸载插件失败", srcUrl, e?.message);
    }
    return false;
}

// ==================== 页面组件 ====================

export default function PluginList() {
    const plugins = useSortedPlugins();
    const { t } = useI18N();

    const [loading, setLoading] = useState(false);
    const [progressText, setProgressText] = useState("");

    const cancelRef = useRef(false);
    const navigator = useNavigation<any>();

    const menuOptions: IOption[] = [
        {
            icon: "bookmark-square",
            title: t("pluginSetting.menu.subscriptionSetting"),
            async onPress() {
                navigator.navigate("/pluginsetting/subscribe");
            },
        },
        {
            icon: "bars-3",
            title: t("pluginSetting.menu.sort"),
            onPress() {
                navigator.navigate("/pluginsetting/sort");
            },
        },
        {
            icon: "trash-outline",
            title: t("pluginSetting.menu.uninstallAll"),
            onPress() {
                showDialog("SimpleDialog", {
                    title: t("pluginSetting.menu.uninstallAll"),
                    content: t("pluginSetting.menu.uninstallAllContent"),
                    async onOk() {
                        setLoading(true);
                        await PluginManager.uninstallAllPlugins();
                        setLoading(false);
                    },
                });
            },
        },
    ];

    async function onInstallFromLocalClick() {
        try {
            const results = await DocumentPicker.getDocumentAsync({
                copyToCacheDirectory: true,
                multiple: true,
                type: ["application/javascript", "text/javascript"],
            });
            if (results.canceled) return;
            setLoading(true);

            await Promise.all(
                results.assets.map(async it => {
                    await PluginManager.installPluginFromLocalFile(it.uri, {
                        notCheckVersion: Config.getConfig(
                            "basic.notCheckPluginVersion",
                        ),
                        useExpoFs: true,
                    });
                }),
            );

            Toast.success(t("toast.installPluginSuccess"));
        } catch (e: any) {
            trace("插件安装失败", e?.message);
            Toast.warn(t("toast.installPluginFail", { reason: e?.message ?? "" }));
        }
        setLoading(false);
    }

    async function onInstallFromNetworkClick() {
        showPanel("SimpleInput", {
            title: t("pluginSetting.menu.installPlugin"),
            placeholder: t("pluginSetting.menu.installPluginDialogPlaceholder"),
            maxLength: 200,
            async onOk(text, closePanel) {
                setLoading(true);
                closePanel();

                cancelRef.current = false;
                const result = await installPluginFromUrl(
                    text.trim(),
                    setProgressText,
                    () => cancelRef.current,
                );
                showInstallSummary(result);

                setProgressText("");
                setLoading(false);
            },
        });
    }

    async function onSubscribeClick() {
        const urls = Config.getConfig("plugin.subscribeUrl");
        if (!urls) {
            Toast.warn(t("toast.noSubscription"));
            return;
        }
        setLoading(true);
        cancelRef.current = false;

        const allResults: IInstallPluginResult[] = [];
        let removedCount = 0;

        try {
            const urlItems = JSON.parse(urls!);
            if (!Array.isArray(urlItems)) throw new Error();

            const previousState = getSubscriptionState();
            const newState: Record<string, string[]> = {};
            const remoteUrlSet = new Set<string>();

            // ========== 阶段 1：获取订阅 ==========
            for (let i = 0; i < urlItems.length; ++i) {
                if (cancelRef.current) break;
                const subUrl = urlItems[i].url;
                setProgressText(`正在获取订阅 ${i + 1}/${urlItems.length}`);
                await new Promise(resolve => setTimeout(resolve, 30));

                try {
                    const remoteUrls = await fetchSubscriptionPluginUrls(subUrl);
                    newState[subUrl] = remoteUrls;
                    remoteUrls.forEach(u => remoteUrlSet.add(u));
                } catch (e: any) {
                    const keep = previousState[subUrl] ?? [];
                    newState[subUrl] = keep;
                    keep.forEach(u => remoteUrlSet.add(u));
                    trace("订阅拉取失败", subUrl, e?.message);
                }
            }

            // ========== 阶段 2：安装/更新 ==========
            const remoteList = Array.from(remoteUrlSet);
            let completedCount = 0;

            for (let i = 0; i < remoteList.length; i += BATCH_SIZE) {
                if (cancelRef.current) break;
                const batch = remoteList.slice(i, i + BATCH_SIZE);

                setProgressText(`正在安装插件 ${completedCount}/${remoteList.length}`);
                await new Promise(resolve => setTimeout(resolve, 30));

                const batchResults = await Promise.allSettled(
                    batch.map((url, index) =>
                        installOnePluginByUrl(
                            url,
                            setProgressText,
                            () => cancelRef.current,
                            completedCount + index + 1,
                            remoteList.length,
                        ),
                    ),
                );

                for (let j = 0; j < batchResults.length; j++) {
                    const res = batchResults[j];
                    if (res.status === "fulfilled") {
                        allResults.push(res.value);
                    } else {
                        allResults.push({
                            success: false,
                            message: (res.reason?.message || String(res.reason)) ?? "未知异常",
                            pluginUrl: batch[j],
                        });
                    }
                }

                completedCount += batch.length;
                setProgressText(`正在安装插件 ${completedCount}/${remoteList.length}`);
            }

            // ========== 阶段 3：删除失效插件 ==========
            const previousAllUrls = new Set<string>();
            for (const subUrl of Object.keys(previousState)) {
                (previousState[subUrl] ?? []).forEach(u => previousAllUrls.add(u));
            }
            const toRemove = Array.from(previousAllUrls).filter(
                u => !remoteUrlSet.has(u),
            );

            for (let i = 0; i < toRemove.length; ++i) {
                if (cancelRef.current) break;
                setProgressText(`正在移除失效插件 ${i + 1}/${toRemove.length}`);
                await new Promise(resolve => setTimeout(resolve, 30));

                const ok = await uninstallPluginBySrcUrl(toRemove[i]);
                if (ok) removedCount++;
            }

            setSubscriptionState(newState);

            if (allResults.length > 0) {
                showInstallSummary(allResults);
            } else if (toRemove.length === 0) {
                Toast.warn(t("toast.subscriptionInvalid"));
            } else if (removedCount > 0) {
                Toast.success(`已移除 ${removedCount} 个失效插件`);
            }
        } catch {
            if (urls?.length) {
                setProgressText("正在安装插件...");
                const result = await installPluginFromUrl(
                    urls,
                    setProgressText,
                    () => cancelRef.current,
                );
                if (result.length > 0) {
                    showInstallSummary(result);
                } else {
                    Toast.warn(t("toast.subscriptionInvalid"));
                }
            }
        }
        setProgressText("");
        setLoading(false);
    }

    async function onUpdateAllClick() {
        const plugins = PluginManager.getEnabledPlugins();
        setLoading(true);
        cancelRef.current = false;

        const allResults: IInstallPluginResult[] = [];

        try {
            for (let i = 0; i < plugins.length; ++i) {
                if (cancelRef.current) break;
                const srcUrl = plugins[i].instance.srcUrl;
                if (srcUrl) {
                    setProgressText(`正在更新插件 ${i + 1}/${plugins.length}`);
                    await new Promise(resolve => setTimeout(resolve, 30));

                    const result = await installPluginFromUrl(
                        srcUrl,
                        setProgressText,
                        () => cancelRef.current,
                    );
                    allResults.push(...result);
                }
            }
            showInstallSummary(
                allResults,
                t("toast.updatePluginSuccess"),
                t("toast.partialPluginUpdateFailed"),
                t("toast.allPluginUpdateFailed"),
            );
        } catch (e: any) {
            Toast.warn(t("toast.unknownError", { reason: e?.message ?? e }));
        }
        setProgressText("");
        setLoading(false);
    }

    function showInstallSummary(
        results: IInstallPluginResult[],
        successMsg?: string,
        partialMsg?: string,
        allFailMsg?: string,
    ) {
        if (!results || results.length === 0) {
            Toast.warn(t("toast.subscriptionInvalid"));
            return;
        }

        const failResults: IInstallPluginResult[] = [];
        let successCount = 0;

        const timeoutFailures: IInstallPluginResult[] = [];
        const invalidFailures: IInstallPluginResult[] = [];
        const otherFailures: IInstallPluginResult[] = [];

        results.forEach(r => {
            if (r.success) {
                successCount++;
            } else {
                failResults.push(r);
                const msg = (r.message ?? "").toLowerCase();
                if (msg.includes("超时") || msg.includes("timeout")) {
                    timeoutFailures.push(r);
                } else if (
                    msg.includes("404") ||
                    msg.includes("403") ||
                    msg.includes("不存在") ||
                    msg.includes("无法解析") ||
                    msg.includes("无法识别")
                ) {
                    invalidFailures.push(r);
                } else {
                    otherFailures.push(r);
                }
            }
        });

        const total = results.length;
        const failCount = failResults.length;

        if (failCount === 0) {
            Toast.success(successMsg ?? t("toast.installPluginSuccess"));
            return;
        }

        const parts: string[] = [`成功 ${successCount}/${total}`];
        const failParts: string[] = [`失败 ${failCount}`];
        if (timeoutFailures.length > 0) failParts.push(`超时 ${timeoutFailures.length}`);
        if (invalidFailures.length > 0) failParts.push(`源失效 ${invalidFailures.length}`);
        if (otherFailures.length > 0) failParts.push(`其他 ${otherFailures.length}`);
        const summaryText = `${parts.join("，")}（${failParts.join(" · ")}）`;

        Toast.warn(
            successCount > 0
                ? (partialMsg ?? t("toast.partialPluginInstallFailed"))
                : (allFailMsg ?? t("toast.allPluginInstallFailed")),
            {
                type: "warn",
                duration: 4000,
                actionText: `查看详情（${summaryText}）`,
                onActionClick: () => {
                    showDialog("SimpleDialog", {
                        title: t("pluginSetting.menu.pluginInstallFailedDialogTitle"),
                        content: failResults
                            .map(
                                it =>
                                    (it.pluginUrl ?? "") +
                                    "\n" +
                                    t("pluginSetting.failReason", {
                                        reason: it.message ?? "",
                                    }),
                            )
                            .join("\n-----\n"),
                    });
                },
            },
        );
    }

    function openInstallMenu() {
        showPanel("SimpleSelect", {
            header: t("pluginSetting.menu.installPlugin"),
            candidates: [
                {
                    value: "从本地安装插件",
                    title: t("pluginSetting.fabOptions.installFromLocal"),
                },
                {
                    value: "从网络安装插件",
                    title: t("pluginSetting.fabOptions.installFromNetwork"),
                },
                {
                    value: "更新全部插件",
                    title: t("pluginSetting.fabOptions.updateAllPlugins"),
                },
                {
                    value: "更新订阅",
                    title: t("pluginSetting.fabOptions.updateSubscription"),
                },
            ],
            onPress(item) {
                if (item.value === "从本地安装插件") {
                    onInstallFromLocalClick();
                } else if (item.value === "从网络安装插件") {
                    onInstallFromNetworkClick();
                } else if (item.value === "更新订阅") {
                    onSubscribeClick();
                } else if (item.value === "更新全部插件") {
                    onUpdateAllClick();
                }
            },
        });
    }

    const isEmpty = !plugins || plugins.length === 0;

    return (
        <>
            <AppBar
                actions={[
                    {
                        icon: "plus",
                        accessibilityLabel: t("pluginSetting.menu.installPlugin"),
                        hasTVPreferredFocus: !isEmpty,
                        onPress: openInstallMenu,
                    },
                ]}
                menu={menuOptions}>
                {t("sidebar.pluginManagement")}
            </AppBar>
            <HorizontalSafeAreaView style={style.wrapper}>
                {loading ? (
                    <View style={style.loadingWrapper}>
                        <Loading />
                        {progressText ? (
                            <Text style={style.progressText}>{progressText}</Text>
                        ) : null}
                    </View>
                ) : isEmpty ? (
                    <EmptyPluginGuide onPress={openInstallMenu} />
                ) : (
                    <FlatList
                        data={plugins ?? []}
                        keyExtractor={_ => _.hash}
                        renderItem={({ item: plugin }) => (
                            <PluginItem key={plugin.hash} plugin={plugin} />
                        )}
                        ListFooterComponent={
                            <AddMoreFooter onPress={openInstallMenu} />
                        }
                    />
                )}
            </HorizontalSafeAreaView>
        </>
    );
}

const style = StyleSheet.create({
    wrapper: {
        width: "100%",
        flex: 1,
    },
    loadingWrapper: {
        flex: 1,
        width: "100%",
        justifyContent: "center",
        alignItems: "center",
    },
    progressText: {
        marginTop: rpx(24),
        fontSize: rpx(32),
        color: "#FFFFFF",
        fontWeight: "bold",
        textAlign: "center",
        paddingHorizontal: rpx(40),
    },
    emptyWrapper: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingVertical: rpx(100),
    },
    emptyButton: {
        width: rpx(180),
        height: rpx(180),
        borderRadius: rpx(90),
        borderWidth: rpx(4),
        borderColor: "rgba(255, 255, 255, 0.4)",
        justifyContent: "center",
        alignItems: "center",
        marginBottom: rpx(40),
    },
    emptyButtonPlus: {
        fontSize: rpx(100),
        lineHeight: rpx(110),
        textAlign: "center",
    },
    emptyTitle: {
        fontSize: rpx(36),
        opacity: 0.95,
        marginBottom: rpx(16),
    },
    emptySubTitle: {
        fontSize: rpx(28),
        opacity: 0.7,
        marginBottom: rpx(24),
    },
    emptyHint: {
        fontSize: rpx(22),
        opacity: 0.45,
        paddingHorizontal: rpx(40),
        textAlign: "center",
    },
    addMoreButton: {
        marginTop: rpx(24),
        marginBottom: rpx(60),
        marginHorizontal: rpx(20),
        paddingVertical: rpx(36),
        borderRadius: rpx(16),
        borderWidth: rpx(2),
        borderStyle: "dashed",
        borderColor: "rgba(255, 255, 255, 0.2)",
        justifyContent: "center",
        alignItems: "center",
    },
    addMoreText: {
        fontSize: rpx(28),
        opacity: 0.55,
    },
});
