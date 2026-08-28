import Divider from "@/components/base/divider";
import LinkText from "@/components/base/linkText";
import ThemeText from "@/components/base/themeText";
import TVPressable from "@/components/tv/TVPressable";
import { TVColors } from "@/constants/tvTheme";
import useCheckUpdate from "@/hooks/useCheckUpdate";
import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

export default function AboutSetting() {
    const checkAndShowResult = useCheckUpdate();
    return (
        <ScrollView contentContainerStyle={styles.page}>
            <View style={styles.hero}>
                <ThemeText style={styles.kicker}>ANDROID TV EDITION</ThemeText>
                <ThemeText style={styles.title}>MusicFreeTV</ThemeText>
                <ThemeText style={styles.subtitle}>面向电视与遥控器重新设计的插件化音乐播放器</ThemeText>
                <TVPressable accessibilityRole="button" accessibilityLabel="检查更新" onPress={() => checkAndShowResult(true)} style={styles.updateButton}>
                    <ThemeText style={styles.updateText}>检查更新</ThemeText>
                </TVPressable>
            </View>
            <View style={styles.card}>
                <ThemeText style={styles.heading}>开源与出处</ThemeText>
                <ThemeText style={styles.body}>
                    MusicFreeTV 是 MusicFree 的独立派生项目。原项目由猫头猫（maotoumao）开发，原始代码地址：{" "}
                    <LinkText linkTo="https://github.com/maotoumao/MusicFree">github.com/maotoumao/MusicFree</LinkText>
                    。本项目不是原作者发布的官方 TV 版本。
                </ThemeText>
                <Divider style={styles.divider} />
                <ThemeText style={styles.body}>
                    本项目继续使用 GNU Affero General Public License v3.0。二次修改和网络提供服务时，应按协议提供对应源代码；分发时必须保留原作者、原仓库和许可证信息。本项目免费，不用于商业用途，不以 VIP、破解或绕过付费为宣传内容。
                </ThemeText>
            </View>
            <View style={styles.card}>
                <ThemeText style={styles.heading}>插件与隐私</ThemeText>
                <ThemeText style={styles.body}>
                    应用本身不内置任何平台音源。搜索、播放、歌词和在线歌单由用户安装的插件提供；请只安装可信插件并合法使用。应用数据默认保存在设备本地，不要求登录，也不由 MusicFreeTV 服务收集个人信息。插件自己的联网与数据行为由插件提供者负责。
                </ThemeText>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    page: { padding: 42, paddingBottom: 90, gap: 22 },
    hero: { padding: 34, borderRadius: 22, backgroundColor: TVColors.raised },
    kicker: { color: TVColors.brand, fontSize: 13, fontWeight: "800", letterSpacing: 2 },
    title: { color: TVColors.text, fontSize: 38, fontWeight: "800", marginTop: 8 },
    subtitle: { color: TVColors.textSecondary, fontSize: 18, marginTop: 8 },
    updateButton: { width: 150, height: 54, marginTop: 25, backgroundColor: TVColors.soft },
    updateText: { flex: 1, color: TVColors.text, fontSize: 17, fontWeight: "700", textAlign: "center", textAlignVertical: "center" },
    card: { padding: 30, borderRadius: 18, backgroundColor: TVColors.surface },
    heading: { color: TVColors.text, fontSize: 23, fontWeight: "700", marginBottom: 14 },
    body: { color: TVColors.textSecondary, fontSize: 17, lineHeight: 30 },
    divider: { marginVertical: 20 },
});
