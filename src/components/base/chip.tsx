import React, { ReactNode } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import rpx from "@/utils/rpx";
import ThemeText from "./themeText";
import useColors from "@/hooks/useColors";
import IconButton from "./iconButton";
import TVPressable from "@/components/tv/TVPressable";

interface IChipProps {
    containerStyle?: StyleProp<ViewStyle>;
    children?: ReactNode;
    onPress?: () => void;
    onClose?: () => void;
}
export default function Chip(props: IChipProps) {
    const { containerStyle, children, onPress, onClose } = props;
    const colors = useColors();

    return (
        <TVPressable
            accessibilityRole="button"
            onPress={onPress}
            style={[
                styles.container,
                {
                    backgroundColor: colors.placeholder,
                },
                containerStyle,
            ]}>
            <View style={styles.content}>
                {typeof children === "string" ? (
                    <ThemeText fontSize="subTitle" numberOfLines={1}>
                        {children}
                    </ThemeText>
                ) : (
                    children
                )}
                <IconButton onPress={onClose} name="x-mark" sizeType="small" style={styles.icon} />
            </View>
        </TVPressable>
    );
}

const styles = StyleSheet.create({
    container: {
        height: rpx(56),
        paddingHorizontal: rpx(18),
        borderRadius: rpx(28),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    content: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    icon: {
        marginLeft: rpx(8),
    },
});
