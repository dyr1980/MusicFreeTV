import React, { useEffect } from "react";
import {
    StyleSheet,
    SwitchProps,
    View,
} from "react-native";
import useColors from "@/hooks/useColors";
import rpx from "@/utils/rpx";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import { timingConfig } from "@/constants/commonConst";
import TVPressable from "@/components/tv/TVPressable";

interface ISwitchProps extends SwitchProps {}

const fixedWidth = rpx(40);

export default function ThemeSwitch(props: ISwitchProps) {
    const { value, onValueChange } = props;
    const colors = useColors();

    const sharedValue = useSharedValue(value ? 1 : 0);

    useEffect(() => {
        sharedValue.value = value ? 1 : 0;
    }, [value]);

    const thumbStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {
                    translateX: withTiming(
                        sharedValue.value * fixedWidth,
                        timingConfig.animationNormal,
                    ),
                },
            ],
        };
    });

    return (
        <TVPressable
            accessibilityRole="switch"
            accessibilityState={{ checked: value }}
            style={styles.touchTarget}
            onPress={() => {
                onValueChange?.(!value);
            }}>
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: value
                            ? colors.primary
                            : colors.textSecondary,
                    },
                    props?.style,
                ]}>
                <Animated.View style={[styles.thumb, thumbStyle]} />
            </View>
        </TVPressable>
    );
}

const styles = StyleSheet.create({
    touchTarget: {
        width: rpx(92),
        height: rpx(56),
        alignItems: "center",
        justifyContent: "center",
    },
    container: {
        width: rpx(80),
        height: rpx(40),
        borderRadius: rpx(40),
        justifyContent: "center",
    },
    thumb: {
        width: rpx(34),
        height: rpx(34),
        borderRadius: rpx(17),
        backgroundColor: "white",
        left: rpx(3),
    },
});
