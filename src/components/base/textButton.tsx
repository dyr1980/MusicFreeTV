import React from "react";
import { View } from "react-native";
import ThemeText from "./themeText";
import rpx from "@/utils/rpx";
import { CustomizedColors } from "@/hooks/useColors";
import TVPressable from "@/components/tv/TVPressable";

interface IButtonProps {
    withHorizontalPadding?: boolean;
    style?: any;
    hitSlop?: number;
    children: string;
    fontColor?: keyof CustomizedColors;
    onPress?: () => void;
}
export default function (props: IButtonProps) {
    const { children, onPress, fontColor, hitSlop, withHorizontalPadding } =
        props;
    return (
        <TVPressable
            style={[
                withHorizontalPadding
                    ? {
                        paddingHorizontal: rpx(24),
                    }
                    : null,
                props.style,
            ]}
            hitSlop={hitSlop ?? (withHorizontalPadding ? 0 : rpx(28))}
            onPress={onPress}
            accessible
            accessibilityLabel={children}>
            <View style={{ minHeight: 48, justifyContent: "center" }}>
                <ThemeText fontColor={fontColor}>{children}</ThemeText>
            </View>
        </TVPressable>
    );
}
