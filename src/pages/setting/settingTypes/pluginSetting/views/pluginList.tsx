import React, { useRef, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import rpx from "@/utils/rpx";
import * as DocumentPicker from "expo-document-picker";
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
 * 主要给手机/平板等单手触摸操作的设备使用
 */
function AddMoreFooter({ onPress }: { onPress: () => void }) {
    return (
        <TouchableOpacity onPress={onPress} style={style.addMoreButton}>
            <ThemeText style={style.addMoreText}>＋ 添加更多插件</ThemeText>
        </TouchableOpacity>
    );
}

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
            if (results.canceled) {
                return;
            }
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
            Toast.warn(t("toast.installPluginFail", {
                reason: e?.message ?? "",
            }));
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

            for (let i = 0; i < urlItems.length; ++i) {
                if (cancelRef.current) break;
                const subUrl = urlItems[i].url;
                setProgressText(`正在获取订阅 ${i + 1}/${urlItems.length}`);

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

            const remoteList = Array.from(remoteUrlSet);
            for (let i = 0; i < remoteList.length; ++i) {
                if (cancelRef.current) break;
                setProgressText(`正在安装插件 ${i + 1}/${remoteList.length}`);
                const r = await installOnePluginByUrl(remoteList[i]);
                allResults.push(r);
            }

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

        const allResults: IInstallPluginResult[] = [];
        cancelRef.current = false;

        try {
            for (let i = 0; i < plugins.length; ++i) {
                if (cancelRef.current) break;
                const srcUrl = plugins[i].instance.srcUrl;
                if (srcUrl) {
                    setProgressText(`正在更新插件 ${i + 1}/${plugins.length}`);
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
            Toast.warn(t("toast.unknownError", {
                reason: e?.message ?? e,
            }));
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

        const successResults: IInstallPluginResult[] = [];
        const failResults: IInstallPluginResult[] = [];

        const timeoutFailures: IInstallPluginResult[] = [];
        const invalidFailures: IInstallPluginResult[] = [];
        const otherFailures: IInstallPluginResult[] = [];

        results.forEach(r => {
            if (r.success) {
                successResults.push(r);
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
        const successCount = successResults.length;
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
                        // 动态焦点分配：列表为空时让位给中央大按钮
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
        fontSize: rpx(28),
        opacity: 0.7,
        textAlign: "center",
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
            const jsonFile = (
                await axios.get(inputUrl, {
                    timeout: 20000,
                    headers: {
                        "Cache-Control": "no-cache",
                        Pragma: "no-cache",
                        Expires: "0",
                    },
                })
            ).data;
            urls = (jsonFile?.plugins ?? []).map((_: any) => _.url);

            if (urls.length === 0) {
                onProgressText?.("订阅源为空");
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
        const SINGLE_TIMEOUT = 15000;

        const downloadOne = async (url: string): Promise<IInstallPluginResult> => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            try {
                const timeoutPromise = new Promise<IInstallPluginResult>(resolve => {
                    timer = setTimeout(() => {
                        resolve({
                            success: false,
                            message: "请求超时（15秒）",
                            pluginUrl: url,
                        });
                    }, SINGLE_TIMEOUT);
                });

                const result = await Promise.race([
                    PluginManager.installPluginFromUrl(url, {
                        notCheckVersion: Config.getConfig(
                            "basic.notCheckPluginVersion",
                        ),
                    }),
                    timeoutPromise,
                ]);
                return result;
            } catch (e: any) {
                return {
                    success: false,
                    message: e?.message ?? String(e),
                    pluginUrl: url,
                };
            } finally {
                if (timer) {
                    clearTimeout(timer);
                    timer = null;
                }
            }
        };

        const BATCH_SIZE = 4;
        const BATCH_DELAY = 500;
        const RETRY_DELAYS = [1000, 2000, 3000];

        const failedUrls: string[] = [];
        const total = urls.length;
        let completed = 0;

        let lastProgressUpdate = 0;
        const PROGRESS_THROTTLE_MS = 200;
        const reportProgress = (current: number) => {
            const now = Date.now();
            if (now - lastProgressUpdate >= PROGRESS_THROTTLE_MS || current === total) {
                lastProgressUpdate = now;
                onProgressText?.(`正在安装插件 ${current}/${total}`);
            }
        };

        for (let i = 0; i < urls.length; i += BATCH_SIZE) {
            if (shouldCancel?.()) break;

            const batch = urls.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(downloadOne));

            for (let j = 0; j < batchResults.length; j++) {
                if (batchResults[j].success) {
                    results.push(batchResults[j]);
                } else {
                    failedUrls.push(batch[j]);
                }
                completed++;
            }

            reportProgress(completed);

            if (i + BATCH_SIZE < urls.length) {
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
            }
        }

        let stillFailed = [...failedUrls];

        for (let round = 0; round < RETRY_DELAYS.length; round++) {
            if (stillFailed.length === 0) break;
            if (shouldCancel?.()) break;

            const roundNo = round + 1;
            const nextRound: string[] = [];
            const totalRetry = stillFailed.length;

            for (let k = 0; k < stillFailed.length; k++) {
                if (shouldCancel?.()) break;

                const url = stillFailed[k];
                onProgressText?.(
                    `重试第 ${roundNo} 轮 · ${k + 1}/${totalRetry}`,
                );
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[round]));
                const r = await downloadOne(url);
                if (r.success) {
                    results.push(r);
                } else {
                    nextRound.push(url);
                }
            }
            stillFailed = nextRound;
        }

        for (const url of stillFailed) {
            results.push({
                success: false,
                message: "网络超时，多次重试仍失败（该源可能已失效）",
                pluginUrl: url,
            });
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
            try { return JSON.parse(raw); } catch { return {}; }
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
    const jsonFile = (
        await axios.get(subUrl, {
            timeout: 20000,
            headers: {
                "Cache-Control": "no-cache",
                Pragma: "no-cache",
                Expires: "0",
            },
        })
    ).data;
    const urls: string[] = (jsonFile?.plugins ?? [])
        .map((_: any) => _.url)
        .filter((u: any) => u && String(u).trim());
    return Array.from(new Set(urls));
}

async function installOnePluginByUrl(url: string): Promise<IInstallPluginResult> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        const timeoutPromise = new Promise<IInstallPluginResult>(resolve => {
            timer = setTimeout(() => {
                resolve({
                    success: false,
                    message: "请求超时（15秒）",
                    pluginUrl: url,
                });
            }, 15000);
        });
        return await Promise.race([
            PluginManager.installPluginFromUrl(url, {
                notCheckVersion: Config.getConfig("basic.notCheckPluginVersion"),
            }),
            timeoutPromise,
        ]);
    } catch (e: any) {
        return {
            success: false,
            message: e?.message ?? String(e),
            pluginUrl: url,
        };
    } finally {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
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
