import Image from "@/components/base/image";
import Icon, { IIconName } from "@/components/base/icon";
import ThemeText from "@/components/base/themeText";
import TVPressable from "@/components/tv/TVPressable";
import { ImgAsset } from "@/constants/assetsConst";
import { localPluginPlatform } from "@/constants/commonConst";
import { TVColors, TVMetrics } from "@/constants/tvTheme";
import MusicSheet, { useSheetsBase, useStarredSheets } from "@/core/musicSheet";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import TrackPlayer, { useCurrentMusic, useMusicState } from "@/core/trackPlayer";
import { musicIsPaused } from "@/utils/trackUtils";
import React, { useMemo, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";

type Sheet = IMusic.IMusicSheetItemBase;

export default function TVHome() {
    const navigate = useNavigate();
    const currentMusic = useCurrentMusic();
    const musicState = useMusicState();
    const sheets = useSheetsBase();
    const starredSheets = useStarredSheets();
    const [tab, setTab] = useState<"mine" | "starred">("mine");
    const data = useMemo(
        () => (tab === "mine" ? sheets : starredSheets) ?? [],
        [sheets, starredSheets, tab],
    );

    const openSheet = (sheet: Sheet) => {
        const local = !sheet.platform || sheet.platform === localPluginPlatform;
        navigate(
            local ? ROUTE_PATH.LOCAL_SHEET_DETAIL : ROUTE_PATH.PLUGIN_SHEET_DETAIL,
            local ? ({ id: sheet.id } as any) : ({ sheetInfo: sheet } as any),
        );
    };

    const rail: Array<{ icon: IIconName; label: string; action: () => void }> = [
        { icon: "magnifying-glass", label: "搜索", action: () => navigate(ROUTE_PATH.SEARCH_PAGE) },
        { icon: "fire-outline", label: "推荐歌单", action: () => navigate(ROUTE_PATH.RECOMMEND_SHEETS) },
        { icon: "trophy", label: "音乐榜单", action: () => navigate(ROUTE_PATH.TOP_LIST) },
        { icon: "clock-outline", label: "播放历史", action: () => navigate(ROUTE_PATH.HISTORY) },
        { icon: "folder-music-outline", label: "本地音乐", action: () => navigate(ROUTE_PATH.LOCAL) },
        { icon: "javascript", label: "插件管理", action: () => navigate(ROUTE_PATH.SETTING, { type: "plugin" }) },
        { icon: "cog-8-tooth", label: "设置", action: () => navigate(ROUTE_PATH.SETTING, { type: "basic" }) },
    ];

    return (
        <View style={styles.page}>
            <View style={styles.rail}>
                <View style={styles.brandMark}>
                    <Icon name="musical-note" color={TVColors.focus} size={32} />
                </View>
                <ThemeText style={styles.brand}>MusicFreeTV</ThemeText>
                <View style={styles.railItems}>
                    {rail.map((item, index) => (
                        <TVPressable
                            key={item.label}
                            hasTVPreferredFocus={index === 0}
                            accessibilityRole="button"
                            accessibilityLabel={item.label}
                            onPress={item.action}
                            style={styles.railButton}>
                            <View style={styles.railButtonBody}>
                                <Icon name={item.icon} color={TVColors.textSecondary} size={27} />
                                <ThemeText style={styles.railLabel}>{item.label}</ThemeText>
                            </View>
                        </TVPressable>
                    ))}
                </View>
                <ThemeText style={styles.railHint}>方向键移动 · 确认键选择</ThemeText>
            </View>

            <View style={styles.content}>
                <View style={styles.header}>
                    <View>
                        <ThemeText style={styles.eyebrow}>GOOD EVENING</ThemeText>
                        <ThemeText style={styles.title}>在客厅，重新发现音乐</ThemeText>
                    </View>
                    <ThemeText style={styles.clockHint}>TV EDITION</ThemeText>
                </View>

                <View style={styles.hero}>
                    <Image
                        uri={currentMusic?.artwork}
                        emptySrc={ImgAsset.albumDefault}
                        style={styles.heroImage}
                    />
                    <View style={styles.heroCopy}>
                        <ThemeText style={styles.eyebrow}>NOW PLAYING</ThemeText>
                        <ThemeText numberOfLines={1} style={styles.heroTitle}>
                            {currentMusic?.title ?? "你的音乐，已经就位"}
                        </ThemeText>
                        <ThemeText numberOfLines={1} style={styles.heroArtist}>
                            {currentMusic?.artist ?? "安装音源插件或导入本地音乐后开始播放"}
                        </ThemeText>
                        <View style={styles.heroActions}>
                            <TVPressable
                                accessibilityRole="button"
                                accessibilityLabel={musicIsPaused(musicState) ? "播放" : "暂停"}
                                onPress={() =>
                                    musicIsPaused(musicState) ? TrackPlayer.play() : TrackPlayer.pause()
                                }
                                disabled={!currentMusic}
                                style={styles.playButton}
                                focusedStyle={styles.playButtonFocused}>
                                <View style={styles.playButtonBody}>
                                    <Icon
                                        name={musicIsPaused(musicState) ? "play" : "pause"}
                                        color={TVColors.canvas}
                                        size={28}
                                    />
                                    <ThemeText style={styles.playButtonText}>
                                        {musicIsPaused(musicState) ? "播放" : "暂停"}
                                    </ThemeText>
                                </View>
                            </TVPressable>
                            <TVPressable
                                accessibilityRole="button"
                                accessibilityLabel="打开播放页"
                                onPress={() => navigate(ROUTE_PATH.MUSIC_DETAIL)}
                                disabled={!currentMusic}
                                style={styles.secondaryButton}>
                                <ThemeText style={styles.secondaryButtonText}>查看歌词</ThemeText>
                            </TVPressable>
                        </View>
                    </View>
                </View>

                <View style={styles.sectionHeader}>
                    <View style={styles.tabs}>
                        <TVPressable onPress={() => setTab("mine")} style={styles.tab}>
                            <ThemeText style={[styles.tabText, tab === "mine" && styles.tabTextActive]}>
                                我的歌单 {sheets.length}
                            </ThemeText>
                        </TVPressable>
                        <TVPressable onPress={() => setTab("starred")} style={styles.tab}>
                            <ThemeText style={[styles.tabText, tab === "starred" && styles.tabTextActive]}>
                                收藏歌单 {starredSheets.length}
                            </ThemeText>
                        </TVPressable>
                    </View>
                    <ThemeText style={styles.sectionHint}>选择歌单进入歌曲列表</ThemeText>
                </View>

                <FlatList
                    data={data}
                    keyExtractor={item => `${item.platform ?? "local"}-${item.id}`}
                    numColumns={4}
                    contentContainerStyle={styles.grid}
                    columnWrapperStyle={styles.gridRow}
                    renderItem={({ item }) => (
                        <TVPressable
                            accessibilityRole="button"
                            accessibilityLabel={`${item.title}，${item.worksNum ?? 0} 首歌曲`}
                            onPress={() => openSheet(item)}
                            style={styles.sheetCard}>
                            <View style={styles.sheetCardBody}>
                                <Image
                                    uri={item.coverImg ?? item.artwork}
                                    emptySrc={ImgAsset.albumDefault}
                                    style={styles.sheetCover}
                                />
                                <ThemeText numberOfLines={1} style={styles.sheetTitle}>
                                    {item.title}
                                </ThemeText>
                                <ThemeText numberOfLines={1} style={styles.sheetMeta}>
                                    {item.id === MusicSheet.defaultSheet.id
                                        ? "默认收藏"
                                        : item.artist || `${item.worksNum ?? 0} 首歌曲`}
                                </ThemeText>
                            </View>
                        </TVPressable>
                    )}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <ThemeText style={styles.emptyTitle}>这里还没有歌单</ThemeText>
                            <ThemeText style={styles.sheetMeta}>前往搜索或插件管理，开始建立你的音乐库。</ThemeText>
                        </View>
                    }
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: { flex: 1, flexDirection: "row", backgroundColor: TVColors.canvas },
    rail: { width: TVMetrics.railWidth, paddingHorizontal: 24, paddingVertical: 26, backgroundColor: TVColors.surface },
    brandMark: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: TVColors.brand },
    brand: { marginTop: 14, fontSize: 23, fontWeight: "700", color: TVColors.text },
    railItems: { flex: 1, justifyContent: "center", gap: 8 },
    railButton: { width: "100%", height: 62 },
    railButtonBody: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 15 },
    railLabel: { color: TVColors.text, fontSize: 18, fontWeight: "600" },
    railHint: { fontSize: 12, color: TVColors.textSecondary, lineHeight: 18 },
    content: { flex: 1, paddingHorizontal: 38, paddingTop: 28 },
    header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
    eyebrow: { color: TVColors.brand, fontSize: 12, fontWeight: "800", letterSpacing: 2 },
    title: { color: TVColors.text, fontSize: 30, fontWeight: "700", marginTop: 5 },
    clockHint: { color: TVColors.textSecondary, fontSize: 13, letterSpacing: 2 },
    hero: { height: 214, borderRadius: 22, overflow: "hidden", flexDirection: "row", backgroundColor: TVColors.raised, marginBottom: 22 },
    heroImage: { width: 214, height: 214 },
    heroCopy: { flex: 1, paddingHorizontal: 30, paddingVertical: 24, justifyContent: "center" },
    heroTitle: { color: TVColors.text, fontSize: 29, fontWeight: "700", marginTop: 8 },
    heroArtist: { color: TVColors.textSecondary, fontSize: 17, marginTop: 7 },
    heroActions: { flexDirection: "row", gap: 14, marginTop: 20 },
    playButton: { width: 132, height: 52, borderRadius: 26, backgroundColor: TVColors.play },
    playButtonFocused: { borderColor: TVColors.text },
    playButtonBody: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
    playButtonText: { color: TVColors.canvas, fontWeight: "800", fontSize: 17 },
    secondaryButton: { width: 132, height: 52, borderRadius: 26, backgroundColor: TVColors.soft },
    secondaryButtonText: { flex: 1, textAlign: "center", textAlignVertical: "center", fontSize: 17, color: TVColors.text },
    sectionHeader: { height: 60, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    tabs: { flexDirection: "row", gap: 12 },
    tab: { width: 142, height: 50 },
    tabText: { flex: 1, textAlign: "center", textAlignVertical: "center", color: TVColors.textSecondary, fontSize: 17, fontWeight: "600" },
    tabTextActive: { color: TVColors.text },
    sectionHint: { color: TVColors.textSecondary, fontSize: 13 },
    grid: { paddingBottom: 30 },
    gridRow: { gap: 18, marginBottom: 18 },
    sheetCard: { flex: 1, height: 218, maxWidth: "24%", backgroundColor: TVColors.raised },
    sheetCardBody: { flex: 1, padding: 12 },
    sheetCover: { width: "100%", flex: 1, borderRadius: 10 },
    sheetTitle: { color: TVColors.text, fontSize: 16, fontWeight: "700", marginTop: 10 },
    sheetMeta: { color: TVColors.textSecondary, fontSize: 13, marginTop: 3 },
    empty: { width: 560, padding: 30, borderRadius: 16, backgroundColor: TVColors.raised },
    emptyTitle: { color: TVColors.text, fontSize: 20, fontWeight: "700", marginBottom: 7 },
});
