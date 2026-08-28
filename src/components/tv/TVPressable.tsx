import { TVColors, TVMetrics } from "@/constants/tvTheme";
import React, { ReactNode, useRef, useState } from "react";
import {
    Animated,
    Pressable,
    PressableProps,
    StyleProp,
    StyleSheet,
    ViewStyle,
} from "react-native";

interface ITVPressableProps extends Omit<PressableProps, "style" | "children"> {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    focusedStyle?: StyleProp<ViewStyle>;
    hasTVPreferredFocus?: boolean;
}

/** A layout-stable D-pad target with an unmistakable TV focus state. */
export default function TVPressable({
    children,
    style,
    focusedStyle,
    onFocus,
    onBlur,
    disabled,
    focusable,
    ...props
}: ITVPressableProps) {
    const [focused, setFocused] = useState(false);
    const scale = useRef(new Animated.Value(1)).current;

    const animate = (value: number) => {
        Animated.timing(scale, {
            toValue: value,
            duration: 160,
            useNativeDriver: true,
        }).start();
    };

    return (
        <Animated.View style={[style, { transform: [{ scale }] }]}>
            <Pressable
                {...props}
                disabled={disabled}
                focusable={
                    !disabled &&
                    (focusable ?? Boolean(props.onPress || props.onLongPress))
                }
                onFocus={event => {
                    setFocused(true);
                    animate(1.035);
                    onFocus?.(event);
                }}
                onBlur={event => {
                    setFocused(false);
                    animate(1);
                    onBlur?.(event);
                }}
                style={[
                    styles.target,
                    focused && styles.focused,
                    focused && focusedStyle,
                    disabled && styles.disabled,
                ]}>
                {children}
            </Pressable>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    target: {
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: TVMetrics.radius,
        borderWidth: TVMetrics.focusWidth,
        borderColor: "transparent",
        overflow: "hidden",
    },
    focused: {
        borderColor: TVColors.focus,
        backgroundColor: TVColors.soft,
        elevation: 12,
    },
    disabled: {
        opacity: 0.45,
    },
});
