import React from 'react';
import {StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import ThemeText from './themeText';
import rpx from '@/utils/rpx';
import {CustomizedColors} from '@/hooks/useColors';
import TVPressable from '@/components/tv/TVPressable';

interface IButtonProps {
    withHorizontalPadding?: boolean;
    style?: any;
    contentStyle?: StyleProp<ViewStyle>;
    hitSlop?: number;
    children: string;
    fontColor?: keyof CustomizedColors;
    onPress?: () => void;
}
export default function (props: IButtonProps) {
    const {children, onPress, fontColor, hitSlop, withHorizontalPadding} =
        props;
    return (
        <TVPressable
            style={[
                styles.container,
                withHorizontalPadding
                    ? {
                          paddingHorizontal: rpx(24),
                      }
                    : null,
                props.style,
            ]}
            contentStyle={props.contentStyle}
            hitSlop={hitSlop ?? (withHorizontalPadding ? 0 : rpx(28))}
            onPress={onPress}
            accessible
            accessibilityLabel={children}>
            <View style={{minHeight: 48, justifyContent: 'center'}}>
                <ThemeText fontColor={fontColor}>{children}</ThemeText>
            </View>
        </TVPressable>
    );
}

const styles = StyleSheet.create({
    container: {
        height: rpx(64),
        flexShrink: 0,
    },
});
