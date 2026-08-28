import { showPanel } from "@/components/panels/usePanel";
import TrackPlayer, { useMusicState } from "@/core/trackPlayer";
import { musicIsPaused } from "@/utils/trackUtils";
import { useEffect } from "react";
import { DeviceEventEmitter, Platform } from "react-native";

type RemoteAction = "playPause" | "next" | "previous" | "menu";

/** Bridges physical media keys that Android TV does not route through Pressable. */
export default function useTVRemote() {
    const musicState = useMusicState();

    useEffect(() => {
        if (Platform.OS !== "android") {
            return;
        }
        const subscription = DeviceEventEmitter.addListener(
            "MusicFreeTVRemote",
            async (action: RemoteAction) => {
                if (action === "playPause") {
                    if (musicIsPaused(musicState)) {
                        await TrackPlayer.play();
                    } else {
                        await TrackPlayer.pause();
                    }
                } else if (action === "next") {
                    await TrackPlayer.skipToNext();
                } else if (action === "previous") {
                    await TrackPlayer.skipToPrevious();
                } else if (action === "menu") {
                    showPanel("PlayList");
                }
            },
        );
        return () => subscription.remove();
    }, [musicState]);
}
