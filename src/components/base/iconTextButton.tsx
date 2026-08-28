import React from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "./themeText";
import { iconSizeConst } from "@/constants/uiConst";
import useColors from "@/hooks/useColors";
import Icon, { IIconName } from "@/components/base/icon.tsx";
import TVPressable from "@/components/tv/TVPressable";

interface IProps {
    icon: IIconName;
    onPress?: () => void;
    containerStyle?: StyleProp<ViewStyle>;
    children?: string;
}
export default function (props: IProps) {
    const { icon, children, onPress, containerStyle } = props;
    const colors = useColors();

    return (
        <TVPressable
            accessibilityRole="button"
            accessibilityLabel={children}
            style={[style.container, containerStyle]}
            onPress={onPress}>
            <View style={style.content}>
                <Icon name={icon} size={iconSizeConst.light} color={colors.text} />
                <ThemeText style={style.text} fontSize={"content"}>
                    {children}
                </ThemeText>
            </View>
        </TVPressable>
    );
}

const style = StyleSheet.create({
    container: {
        paddingHorizontal: rpx(16),
        paddingVertical: rpx(8),
        minHeight: 56,
    },
    content: {
        flexDirection: "row",
        alignItems: "center",
    },
    text: {
        marginLeft: rpx(8),
    },
});
