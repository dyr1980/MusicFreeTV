import React, {ReactNode} from 'react';
import {StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import rpx from '@/utils/rpx';
import ThemeText from './themeText';
import useColors from '@/hooks/useColors';
import IconButton from './iconButton';
import TVPressable from '@/components/tv/TVPressable';

interface IChipProps {
    containerStyle?: StyleProp<ViewStyle>;
    children?: ReactNode;
    onPress?: () => void;
    onClose?: () => void;
}
export default function Chip(props: IChipProps) {
    const {containerStyle, children, onPress, onClose} = props;
    const colors = useColors();

    return (
        <TVPressable
            accessibilityRole="button"
            onPress={onPress}
            contentStyle={styles.pressable}
            style={[
                styles.container,
                {
                    backgroundColor: colors.placeholder,
                },
                containerStyle,
            ]}>
            <View style={styles.content}>
                {typeof children === 'string' ? (
                    <ThemeText
                        fontSize="subTitle"
                        numberOfLines={1}
                        style={styles.label}>
                        {children}
                    </ThemeText>
                ) : (
                    children
                )}
                <IconButton
                    onPress={onClose}
                    name="x-mark"
                    sizeType="small"
                    style={styles.icon}
                />
            </View>
        </TVPressable>
    );
}

const styles = StyleSheet.create({
    container: {
        width: rpx(208),
        height: rpx(56),
        borderRadius: rpx(28),
    },
    content: {
        position: 'relative',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    pressable: {
        width: 'auto',
        height: '100%',
    },
    label: {
        width: '100%',
        paddingHorizontal: rpx(56),
        textAlign: 'center',
    },
    icon: {
        position: 'absolute',
        right: 0,
        top: 0,
        width: rpx(56),
        height: '100%',
    },
});
