import {
    GestureResponderEvent,
    StyleProp,
    StyleSheet,
    ViewStyle,
} from "react-native";
import useColors from "@/hooks/useColors.ts";
import ThemeText from "@/components/base/themeText.tsx";
import React from "react";
import rpx from "@/utils/rpx.ts";
import TVPressable from "@/components/tv/TVPressable";

export function Button(props: {
    type?: "normal" | "primary";
    text: string;
    style?: StyleProp<ViewStyle>;
    onPress?: (evt: GestureResponderEvent) => void;
}) {
    const { type = "normal", text, style, onPress } = props;
    const colors = useColors();

    return (
        <TVPressable
            accessibilityRole="button"
            accessibilityLabel={text}
            onPress={onPress}
            style={[
                styles.bottomBtn,
                {
                    backgroundColor:
                        type === "normal" ? colors.placeholder : colors.primary,
                },
                style,
            ]}>
            <ThemeText color={type === "normal" ? undefined : "white"}>
                {text}
            </ThemeText>
        </TVPressable>
    );
}

const styles = StyleSheet.create({
    bottomBtn: {
        borderRadius: rpx(8),
        flexShrink: 0,
        justifyContent: "center",
        alignItems: "center",
        height: rpx(72),
    },
});
