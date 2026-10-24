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

function EmptyPluginGuide({ onPress }: { onPress: () => void }) {
    return (
        <View style={style.emptyWrapper}>
            <TouchableOpacity hasTVPreferredFocus={true} onPress={onPress} style={style.emptyButton}>
                <ThemeText style={style.emptyButtonPlus}>＋</ThemeText>
            </TouchableOpacity>
            <ThemeText style={style.emptyTitle}>还没有插件</ThemeText>
            <ThemeText style={style.emptySubTitle}>点这里安装插件</ThemeText>
            <ThemeText style={style.emptyHint}>（也可以用遥控器按"上"选中右上角的"＋"）</ThemeText>
        </View>
    );
}

function AddMoreFooter({ onPress }: { onPress: () => void }) {
    return (
        <TouchableOpacity onPress={onPress} style={style.addMoreButton}>
            <ThemeText style={style.addMoreText}>＋ 添加更多插件</ThemeText>
        </TouchableOpacity>
    );
}

// ==================== 核心修复：原生下载器，彻底根除底层死锁 ====================

const DOWNLOAD_TIMEOUT = 12000; // 12 秒，给慢源充足的下载时间
const MAX_RETRY = 3;            // 恢复 3 次尝试，成功率拉满
const BATCH_SIZE = 3; 

const BROWSER_HEADERS = {
    "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "Expires": "0",
};

function isRetryableError(msg: string): boolean {
    const m = (msg || "").toLowerCase();
    if (
        m.includes("404") || m.includes("403") || m.includes("无法解析") ||
        m.includes("无法识别") || m.includes("内容为空") || m.includes("html")
    ) {
        return false;
    }
    return true;
}

async function downloadAndInstallPlugin(url: string): Promise<IInstallPluginResult> {
    let tmpUri: string | null = null;

    try {
        const safeName = "plugin_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".js";
        tmpUri = (FileSystem.cacheDirectory ?? "") + safeName;

        // 【终极杀招】使用原生下载器，底层等同于系统浏览器，绝不会像 axios 那样死锁
        const downloadRes = await FileSystem.downloadAsync(url, tmpUri, {
            headers: {
                ...BROWSER_HEADERS,
                "Referer": url,
            },
        });

        if (downloadRes.status !== 200) {
            return { success: false, message: `HTTP 状态码 ${downloadRes.status}`, pluginUrl: url };
        }

        // 读取下载下来的文件，检查内容是否合法
        const code = await FileSystem.readAsStringAsync(tmpUri, { encoding: FileSystem.EncodingType.UTF8 });

        if (typeof code !== "string" || code.trim().length === 0) {
            return { success: false, message: "下载内容为空（源已失效）", pluginUrl: url };
        }
        if (code.trim().startsWith("<")) {
            return { success: false, message: "返回 HTML 非 JS（源已失效）", pluginUrl: url };
        }

        const pm: any = PluginManager as any;
        const notCheckVersion = Config.getConfig("basic.notCheckPluginVersion");

        // 路径 A：从代码字符串直接安装
        if (typeof pm.installPluginFromScript === "function") {
            const r = await pm.installPluginFromScript(code, { notCheckVersion });
            if (r === undefined || r?.success) {
                return { success: true, message: "", pluginUrl: url };
            }
            return { success: false, message: r?.message ?? "插件校验失败", pluginUrl: url };
        }

        // 路径 B：既然文件已经下载到本地了，直接走本地安装（彻底避开网络队列）
        try {
            const r = await pm.installPluginFromLocalFile(tmpUri, { notCheckVersion, useExpoFs: true });
            if (r === undefined || r?.success) {
                return { success: true, message: "", pluginUrl: url };
            }
            return { success: false, message: r?.message ?? "本地安装失败", pluginUrl: url };
        } finally {
            // 安装完清理临时文件
            FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
        }
    } catch (e: any) {
        trace("原生下载失败", url, "msg:", e?.message);
        return {
            success: false,
            message: e?.message ?? String(e),
            pluginUrl: url,
        };
    }
}

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
    } catch { /* ignore */ }

    let last: IInstallPluginResult | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        if (shouldCancel?.()) break;

        if (attempt > 1) {
            const progressStr = currentIndex !== undefined && totalCount !== undefined ? ` · 第 ${currentIndex}/${totalCount} 个` : "";
            onProgressText?.(`重试中 ${attempt - 1}/${MAX_RETRY - 1}${progressStr}…`);
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 2)));
        }

        // 外层保险丝：原生下载器不受 AbortController 控制，必须靠 Promise.race 强切
        let absTimer: ReturnType<typeof setTimeout> | null = null;
        const absoluteTimeout = new Promise<IInstallPluginResult>(resolve => {
            absTimer = setTimeout(() => {
                resolve({ success: false, message: "安装流程强制超时（跳过）", pluginUrl: url });
            }, DOWNLOAD_TIMEOUT + 5000);
        });

        last = await Promise.race([
            downloadAndInstallPlugin(url),
            absoluteTimeout
        ]);

        if (absTimer) {
            clearTimeout(absTimer);
            absTimer = null;
        }

        if (last.success) return last;
        if (!isRetryableError(last.message)) break;
    }

    return {
        ...(last ?? { success: false, message: "未知错误", pluginUrl: url }),
        pluginUrl: url,
    };
}

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
            const timer = setTimeout(() => controller.abort(), 15000);
            try {
                const jsonFile = (await axios.get(inputUrl, {
                    timeout: 15000, signal: controller.signal, headers: BROWSER_HEADERS,
                })).data;
                urls = (jsonFile?.plugins ?? []).map((_: any) => _.url);
            } finally {
                clearTimeout(timer);
            }

            if (urls.length === 0) return [{ success: false, message: "订阅 JSON 中没有插件", pluginUrl: inputUrl }];
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
                    installOnePluginByUrl(u, onProgressText, shouldCancel, completed + index + 1, total),
                ),
            );

            for (let j = 0; j < batchResults.length; j++) {
                const res = batchResults[j];
                if (res.status === "fulfilled") results.push(res.value);
                else results.push({ success: false, message: "未知异常", pluginUrl: batch[j] });
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
        if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
        return raw;
    } catch { return {}; }
}

function setSubscriptionState(state: Record<string, string[]>) {
    try { Config.setConfig("plugin.subscribeState" as any, state as any); } catch (e: any) { trace("保存订阅状态失败", e?.message); }
}

async function fetchSubscriptionPluginUrls(subUrl: string): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const jsonFile = (await axios.get(subUrl, { timeout: 15000, signal: controller.signal, headers: BROWSER_HEADERS })).data;
        const urls: string[] = (jsonFile?.plugins ?? []).map((_: any) => _.url).filter((u: any) => u && String(u).trim());
        return Array.from(new Set(urls));
    } finally { clearTimeout(timer); }
}

async function uninstallPluginBySrcUrl(srcUrl: string): Promise<boolean> {
    try {
        const plugins = PluginManager.getSortedPlugins();
        const target = plugins.find(p => p.instance?.srcUrl === srcUrl);
        if (target) { await PluginManager.uninstallPlugin(target.hash); return true; }
    } catch (e: any) { trace("卸载插件失败", srcUrl, e?.message); }
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
        { icon: "bookmark-square", title: t("pluginSetting.menu.subscriptionSetting"), async onPress() { navigator.navigate("/pluginsetting/subscribe"); } },
        { icon: "bars-3", title: t("pluginSetting.menu.sort"), onPress() { navigator.navigate("/pluginsetting/sort"); } },
        {
            icon: "trash-outline", title: t("pluginSetting.menu.uninstallAll"),
            onPress() { showDialog("SimpleDialog", { title: t("pluginSetting.menu.uninstallAll"), content: t("pluginSetting.menu.uninstallAllContent"), async onOk() { setLoading(true); await PluginManager.uninstallAllPlugins(); setLoading(false); } }); },
        },
    ];

    async function onInstallFromLocalClick() {
        try {
            const results = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true, type: ["application/javascript", "text/javascript"] });
            if (results.canceled) return;
            setLoading(true);
            await Promise.all(results.assets.map(async it => {
                await PluginManager.installPluginFromLocalFile(it.uri, { notCheckVersion: Config.getConfig("basic.notCheckPluginVersion"), useExpoFs: true });
            }));
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
                setLoading(true); closePanel(); cancelRef.current = false;
                const result = await installPluginFromUrl(text.trim(), setProgressText, () => cancelRef.current);
                showInstallSummary(result);
                setProgressText(""); setLoading(false);
            },
        });
    }

    async function onSubscribeClick() {
        const urls = Config.getConfig("plugin.subscribeUrl");
        if (!urls) { Toast.warn(t("toast.noSubscription")); return; }
        
        setLoading(true); cancelRef.current = false;
        const allResults: IInstallPluginResult[] = [];
        let removedCount = 0;

        try {
            const urlItems = JSON.parse(urls!);
            if (!Array.isArray(urlItems)) throw new Error();

            const previousState = getSubscriptionState();
            const newState: Record<string, string[]> = {};
            const remoteUrlSet = new Set<string>();

            for (let i = 0; i < urlItems.length; ++i) {
                if (cancelRef.current) break;
                setProgressText(`正在获取订阅 ${i + 1}/${urlItems.length}`);
                await new Promise(resolve => setTimeout(resolve, 30));
                try {
                    const remoteUrls = await fetchSubscriptionPluginUrls(urlItems[i].url);
                    newState[urlItems[i].url] = remoteUrls;
                    remoteUrls.forEach(u => remoteUrlSet.add(u));
                } catch (e: any) {
                    const keep = previousState[urlItems[i].url] ?? [];
                    newState[urlItems[i].url] = keep;
                    keep.forEach(u => remoteUrlSet.add(u));
                    trace("订阅拉取失败", urlItems[i].url, e?.message);
                }
            }

            const remoteList = Array.from(remoteUrlSet);
            let completedCount = 0;

            for (let i = 0; i < remoteList.length; i += BATCH_SIZE) {
                if (cancelRef.current) break;
                const batch = remoteList.slice(i, i + BATCH_SIZE);

                setProgressText(`正在安装插件 ${completedCount}/${remoteList.length}`);
                await new Promise(resolve => setTimeout(resolve, 30));

                const batchResults = await Promise.allSettled(
                    batch.map((url, index) => installOnePluginByUrl(
                        url, setProgressText, () => cancelRef.current,
                        completedCount + index + 1, remoteList.length
                    ))
                );

                for (let j = 0; j < batchResults.length; j++) {
                    const res = batchResults[j];
                    if (res.status === "fulfilled") allResults.push(res.value);
                    else allResults.push({ success: false, message: "未知异常", pluginUrl: batch[j] });
                }

                completedCount += batch.length;
                setProgressText(`正在安装插件 ${completedCount}/${remoteList.length}`);
            }

            const previousAllUrls = new Set<string>();
            for (const subUrl of Object.keys(previousState)) { (previousState[subUrl] ?? []).forEach(u => previousAllUrls.add(u)); }
            const toRemove = Array.from(previousAllUrls).filter(u => !remoteUrlSet.has(u));

            for (let i = 0; i < toRemove.length; ++i) {
                if (cancelRef.current) break;
                setProgressText(`正在移除失效插件 ${i + 1}/${toRemove.length}`);
                await new Promise(resolve => setTimeout(resolve, 30));
                if (await uninstallPluginBySrcUrl(toRemove[i])) removedCount++;
            }

            setSubscriptionState(newState);

            if (allResults.length > 0) showInstallSummary(allResults);
            else if (toRemove.length === 0) Toast.warn(t("toast.subscriptionInvalid"));
            else if (removedCount > 0) Toast.success(`已移除 ${removedCount} 个失效插件`);

        } catch {
            if (urls?.length) {
                setProgressText("正在安装插件...");
                const result = await installPluginFromUrl(urls, setProgressText, () => cancelRef.current);
                if (result.length > 0) showInstallSummary(result);
                else Toast.warn(t("toast.subscriptionInvalid"));
            }
        }
        setProgressText(""); setLoading(false);
    }

    async function onUpdateAllClick() {
        const plugins = PluginManager.getEnabledPlugins();
        setLoading(true); cancelRef.current = false;
        const allResults: IInstallPluginResult[] = [];

        try {
            for (let i = 0; i < plugins.length; ++i) {
                if (cancelRef.current) break;
                const srcUrl = plugins[i].instance.srcUrl;
                if (srcUrl) {
                    setProgressText(`正在更新插件 ${i + 1}/${plugins.length}`);
                    await new Promise(resolve => setTimeout(resolve, 30));
                    const result = await installPluginFromUrl(srcUrl, setProgressText, () => cancelRef.current);
                    allResults.push(...result);
                }
            }
            showInstallSummary(allResults, t("toast.updatePluginSuccess"), t("toast.partialPluginUpdateFailed"), t("toast.allPluginUpdateFailed"));
        } catch (e: any) {
            Toast.warn(t("toast.unknownError", { reason: e?.message ?? e }));
        }
        setProgressText(""); setLoading(false);
    }

    function showInstallSummary(results: IInstallPluginResult[], successMsg?: string, partialMsg?: string, allFailMsg?: string) {
        if (!results || results.length === 0) { Toast.warn(t("toast.subscriptionInvalid")); return; }

        const successResults: IInstallPluginResult[] = [];
        const failResults: IInstallPluginResult[] = [];
        const timeoutFailures: IInstallPluginResult[] = [];
        const invalidFailures: IInstallPluginResult[] = [];
        const otherFailures: IInstallPluginResult[] = [];

        results.forEach(r => {
            if (r.success) successResults.push(r);
            else {
                failResults.push(r);
                const msg = (r.message ?? "").toLowerCase();
                if (msg.includes("超时") || msg.includes("timeout")) timeoutFailures.push(r);
                else if (msg.includes("404") || msg.includes("403") || msg.includes("不存在") || msg.includes("无法解析") || msg.includes("无法识别")) invalidFailures.push(r);
                else otherFailures.push(r);
            }
        });

        const total = results.length;
        const successCount = successResults.length;
        const failCount = failResults.length;

        if (failCount === 0) { Toast.success(successMsg ?? t("toast.installPluginSuccess")); return; }

        const parts: string[] = [`成功 ${successCount}/${total}`];
        const failParts: string[] = [`失败 ${failCount}`];
        if (timeoutFailures.length > 0) failParts.push(`超时 ${timeoutFailures.length}`);
        if (invalidFailures.length > 0) failParts.push(`源失效 ${invalidFailures.length}`);
        if (otherFailures.length > 0) failParts.push(`其他 ${otherFailures.length}`);
        const summaryText = `${parts.join("，")}（${failParts.join(" · ")}）`;

        Toast.warn(successCount > 0 ? (partialMsg ?? t("toast.partialPluginInstallFailed")) : (allFailMsg ?? t("toast.allPluginInstallFailed")), {
            type: "warn", duration: 4000,
            actionText: `查看详情（${summaryText}）`,
            onActionClick: () => {
                showDialog("SimpleDialog", {
                    title: t("pluginSetting.menu.pluginInstallFailedDialogTitle"),
                    content: failResults.map(it => (it.pluginUrl ?? "") + "\n" + t("pluginSetting.failReason", { reason: it.message ?? "" })).join("\n-----\n"),
                    okText: "重试失败插件",
                    cancelText: "放弃",
                    async onOk() {
                        setLoading(true);
                        setProgressText("正在重试失败插件...");
                        const retryResults: IInstallPluginResult[] = [];
                        
                        for (let i = 0; i < failResults.length; i++) {
                            setProgressText(`重试中 (${i + 1}/${failResults.length}) · 请稍候...`);
                            const r = await installOnePluginByUrl(failResults[i].pluginUrl, undefined, undefined, undefined, undefined);
                            retryResults.push(r);
                        }

                        setLoading(false);
                        setProgressText("");
                        showInstallSummary(retryResults, successMsg, partialMsg, allFailMsg);
                    }
                });
            },
        });
    }

    function openInstallMenu() {
        showPanel("SimpleSelect", {
            header: t("pluginSetting.menu.installPlugin"),
            candidates: [
                { value: "从本地安装插件", title: t("pluginSetting.fabOptions.installFromLocal") },
                { value: "从网络安装插件", title: t("pluginSetting.fabOptions.installFromNetwork") },
                { value: "更新全部插件", title: t("pluginSetting.fabOptions.updateAllPlugins") },
                { value: "更新订阅", title: t("pluginSetting.fabOptions.updateSubscription") },
            ],
            onPress(item) {
                if (item.value === "从本地安装插件") onInstallFromLocalClick();
                else if (item.value === "从网络安装插件") onInstallFromNetworkClick();
                else if (item.value === "更新订阅") onSubscribeClick();
                else if (item.value === "更新全部插件") onUpdateAllClick();
            },
        });
    }

    const isEmpty = !plugins || plugins.length === 0;

    return (
        <>
            <AppBar actions={[{ icon: "plus", accessibilityLabel: t("pluginSetting.menu.installPlugin"), hasTVPreferredFocus: !isEmpty, onPress: openInstallMenu }]} menu={menuOptions}>
                {t("sidebar.pluginManagement")}
            </AppBar>
            <HorizontalSafeAreaView style={style.wrapper}>
                {loading ? (
                    <View style={style.loadingWrapper}>
                        <Loading />
                        {progressText ? <Text style={style.progressText}>{progressText}</Text> : null}
                    </View>
                ) : isEmpty ? (
                    <EmptyPluginGuide onPress={openInstallMenu} />
                ) : (
                    <FlatList
                        data={plugins ?? []}
                        keyExtractor={_ => _.hash}
                        renderItem={({ item: plugin }) => <PluginItem key={plugin.hash} plugin={plugin} />}
                        ListFooterComponent={<AddMoreFooter onPress={openInstallMenu} />}
                    />
                )}
            </HorizontalSafeAreaView>
        </>
    );
}

const style = StyleSheet.create({
    wrapper: { width: "100%", flex: 1 },
    loadingWrapper: { flex: 1, width: "100%", justifyContent: "center", alignItems: "center" },
    progressText: { marginTop: rpx(24), fontSize: rpx(32), color: "#FFFFFF", fontWeight: "bold", textAlign: "center", paddingHorizontal: rpx(40) },
    emptyWrapper: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: rpx(100) },
    emptyButton: { width: rpx(180), height: rpx(180), borderRadius: rpx(90), borderWidth: rpx(4), borderColor: "rgba(255, 255, 255, 0.4)", justifyContent: "center", alignItems: "center", marginBottom: rpx(40) },
    emptyButtonPlus: { fontSize: rpx(100), lineHeight: rpx(110), textAlign: "center" },
    emptyTitle: { fontSize: rpx(36), opacity: 0.95, marginBottom: rpx(16) },
    emptySubTitle: { fontSize: rpx(28), opacity: 0.7, marginBottom: rpx(24) },
    emptyHint: { fontSize: rpx(22), opacity: 0.45, paddingHorizontal: rpx(40), textAlign: "center" },
    addMoreButton: { marginTop: rpx(24), marginBottom: rpx(60), marginHorizontal: rpx(20), paddingVertical: rpx(36), borderRadius: rpx(16), borderWidth: rpx(2), borderStyle: "dashed", borderColor: "rgba(255, 255, 255, 0.2)", justifyContent: "center", alignItems: "center" },
    addMoreText: { fontSize: rpx(28), opacity: 0.55 },
});
