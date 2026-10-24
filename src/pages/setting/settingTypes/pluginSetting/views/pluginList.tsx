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

// ============================================================
// 最终定稿：可中断原生下载 + 自动重试 + 安装看门狗 + 全局熔断
// ============================================================

const DOWNLOAD_TIMEOUT = 12000; 
const INSTALL_TIMEOUT = 10000;  
const MAX_RETRY = 3;            
// 【极其重要】针对重度混淆代码，必须降为 1！否则并发解析会导致低配设备直接闪退
const BATCH_SIZE = 1;           
const MAX_CONSECUTIVE_FAILS = 5; 

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
    if (m.includes("404") || m.includes("403") || m.includes("无效")) return false;
    return true;
}

async function downloadPluginFile(url: string): Promise<{ url: string; uri?: string; message?: string }> {
    let tmpUri: string | null = null;
    let downloadResumable: FileSystem.DownloadResumable | null = null;

    try {
        const safeName = "plugin_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".js";
        tmpUri = (FileSystem.cacheDirectory ?? "") + safeName;

        downloadResumable = FileSystem.createDownloadResumable(
            url,
            tmpUri,
            { headers: { ...BROWSER_HEADERS, "Referer": url } },
        );

        let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => {
                downloadResumable?.cancelAsync().catch(() => {});
                reject(new Error("下载超时"));
            }, DOWNLOAD_TIMEOUT);
        });

        let downloadRes: FileSystem.FileSystemDownloadResult | undefined;
        try {
            downloadRes = (await Promise.race([
                downloadResumable.downloadAsync(),
                timeoutPromise,
            ])) as FileSystem.FileSystemDownloadResult;
        } finally {
            if (timeoutTimer) clearTimeout(timeoutTimer);
        }

        if (!downloadRes || downloadRes.status !== 200) {
            return { url, message: `HTTP ${downloadRes?.status || "未知"}` };
        }
        return { url, uri: tmpUri };
    } catch (e: any) {
        return { url, message: e?.message ?? String(e) };
    }
}

async function installPluginFromLocalUri(url: string, uri: string): Promise<IInstallPluginResult> {
    const pm: any = PluginManager as any;
    const notCheckVersion = Config.getConfig("basic.notCheckPluginVersion");

    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    let watchdogWon = false;
    const watchdog = new Promise<IInstallPluginResult>(resolve => {
        watchdogTimer = setTimeout(() => {
            watchdogWon = true;
            resolve({ success: false, message: "安装解析超时（已跳过）", pluginUrl: url });
        }, INSTALL_TIMEOUT);
    });

    try {
        const code = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
        if (typeof code !== "string" || code.trim().length === 0) throw new Error("内容为空");
        if (code.trim().startsWith("<")) throw new Error("返回 HTML 而非 JS");

        let installPromise: Promise<IInstallPluginResult>;
        if (typeof pm.installPluginFromScript === "function") {
            installPromise = (async () => {
                const r = await pm.installPluginFromScript(code, { notCheckVersion });
                return { success: r === undefined || r?.success, message: r?.message ?? "", pluginUrl: url };
            })();
        } else {
            installPromise = (async () => {
                const r = await pm.installPluginFromLocalFile(uri, { notCheckVersion, useExpoFs: true });
                return { success: r === undefined || r?.success, message: r?.message ?? "", pluginUrl: url };
            })();
        }

        return await Promise.race([installPromise, watchdog]);
    } catch (e: any) {
        return { success: false, message: e?.message ?? String(e), pluginUrl: url };
    } finally {
        if (watchdogTimer) clearTimeout(watchdogTimer);
        setTimeout(() => {
            FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        }, watchdogWon ? 30000 : 5000);
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
            return { success: true, message: "已安装", pluginUrl: url };
        }
    } catch { /* ignore */ }

    const pStr = currentIndex && totalCount ? ` · 第 ${currentIndex}/${totalCount} 个` : "";
    let last: IInstallPluginResult | null = null;

    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
        if (shouldCancel?.()) break;

        if (attempt > 1) {
            onProgressText?.(`重试中 ${attempt - 1}/${MAX_RETRY - 1}${pStr}…`);
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt - 1)));
        }

        onProgressText?.(`正在下载${pStr}…`);
        // 留出时间给 UI 渲染文字
        await new Promise(resolve => setTimeout(resolve, 50)); 
        const downloadRes = await downloadPluginFile(url);
        
        if (!downloadRes.uri) {
            last = { success: false, message: downloadRes.message || "下载失败", pluginUrl: url };
            if (!isRetryableError(last.message)) break;
            continue;
        }

        if (shouldCancel?.()) {
            FileSystem.deleteAsync(downloadRes.uri, { idempotent: true }).catch(() => {});
            return { success: false, message: "已取消", pluginUrl: url };
        }

        // 【重点提示】给用户打个预防针，马上要卡主线程解析混淆代码了
        onProgressText?.(`正在解析插件代码${pStr}，设备可能暂短卡顿…`);
        await new Promise(resolve => setTimeout(resolve, 100)); 

        last = await installPluginFromLocalUri(url, downloadRes.uri);
        if (last.success) return last;
        if (!isRetryableError(last.message)) break;
    }

    return last ?? { success: false, message: "未知错误", pluginUrl: url };
}

// 辅助函数...
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
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const jsonFile = (await axios.get(subUrl, { timeout: 10000, signal: controller.signal, headers: BROWSER_HEADERS })).data;
        return Array.from(new Set(((jsonFile?.plugins ?? []) as any[]).map((_: any) => _.url).filter((u: any) => u && String(u).trim())));
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
async function installPluginFromUrl(text: string, onProgressText?: (txt: string) => void, shouldCancel?: () => boolean): Promise<IInstallPluginResult[]> {
    try {
        let urls: string[] = [];
        const inputUrl = text.trim();
        if (text.endsWith(".json")) {
            onProgressText?.("正在获取订阅 JSON...");
            urls = await fetchSubscriptionPluginUrls(inputUrl);
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
                batch.map((u, index) => installOnePluginByUrl(u, onProgressText, shouldCancel, completed + index + 1, total)),
            );
            for (let j = 0; j < batchResults.length; j++) {
                const res = batchResults[j];
                if (res.status === "fulfilled") results.push(res.value);
                else results.push({ success: false, message: "未知异常", pluginUrl: batch[j] });
                completed++;
            }
            onProgressText?.(`正在安装插件 ${completed}/${total}`);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        return results;
    } catch (e: any) {
        return [{ success: false, message: e?.message, pluginUrl: text }];
    }
}

// ============================================================
// 页面组件
// ============================================================

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
        let consecutiveFails = 0; 

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
                if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
                    Toast.warn("连续多个插件网络失败，已停止。");
                    break;
                }

                const batch = remoteList.slice(i, i + BATCH_SIZE);
                setProgressText(`正在安装插件 ${completedCount}/${remoteList.length}`);
                await new Promise(resolve => setTimeout(resolve, 30));

                const batchResults = await Promise.allSettled(
                    batch.map((url, index) => installOnePluginByUrl(url, setProgressText, () => cancelRef.current, completedCount + index + 1, remoteList.length)),
                );

                for (let j = 0; j < batchResults.length; j++) {
                    const res = batchResults[j];
                    if (res.status === "fulfilled") {
                        allResults.push(res.value);
                        if (res.value.success) consecutiveFails = 0;
                        else consecutiveFails++;
                    } else {
                        allResults.push({ success: false, message: "异常", pluginUrl: batch[j] });
                        consecutiveFails++;
                    }
                }
                completedCount += batch.length;
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
        } catch { /* ignore */ }
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
                    const result = await installOnePluginByUrl(srcUrl, setProgressText, () => cancelRef.current);
                    allResults.push(result);
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
        const successResults = results.filter(r => r.success);
        const failResults = results.filter(r => !r.success);

        if (failResults.length === 0) { Toast.success(successMsg ?? t("toast.installPluginSuccess")); return; }

        const summaryText = `成功 ${successResults.length}/${results.length}（失败 ${failResults.length}）`;
        const detailText = failResults.map(it => (it.pluginUrl ?? "") + "\n" + (it.message ?? "")).join("\n-----\n");

        Toast.warn(
            successResults.length > 0 ? (partialMsg ?? t("toast.partialPluginInstallFailed")) : (allFailMsg ?? t("toast.allPluginInstallFailed")),
            {
                type: "warn", duration: 4000, actionText: `查看详情（${summaryText}）`,
                onActionClick: () => {
                    showDialog("SimpleDialog", {
                        title: t("pluginSetting.menu.pluginInstallFailedDialogTitle"),
                        content: detailText,
                        okText: "重试失败插件", cancelText: "放弃",
                        async onOk() {
                            setLoading(true); setProgressText("正在重试失败插件...");
                            const retryResults: IInstallPluginResult[] = [];
                            for (let i = 0; i < failResults.length; i++) {
                                setProgressText(`重试中 (${i + 1}/${failResults.length})`);
                                const r = await installOnePluginByUrl(failResults[i].pluginUrl);
                                retryResults.push(r);
                            }
                            setLoading(false); setProgressText("");
                            showInstallSummary(retryResults, successMsg, partialMsg, allFailMsg);
                        },
                    });
                },
            },
        );
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
                    <View style={style.emptyWrapper}>
                        <Text style={style.emptyText}>还没有插件，点右上角 ＋ 安装</Text>
                    </View>
                ) : (
                    <FlatList
                        data={plugins ?? []}
                        keyExtractor={_ => _.hash}
                        renderItem={({ item: plugin }) => <PluginItem key={plugin.hash} plugin={plugin} />}
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
    emptyWrapper: { flex: 1, justifyContent: "center", alignItems: "center" },
    emptyText: { fontSize: rpx(30), opacity: 0.6, textAlign: "center", paddingHorizontal: rpx(40) },
});
