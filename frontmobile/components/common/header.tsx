import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { Image, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import Avatar from "@/components/Avatar";
import { icons } from "@/constants";

interface HeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  notificationCount?: number;
  onPressNotification?: () => void;
  showNotification?: boolean;
  showAvatar?: boolean;
  avatarUrl?: string;
  avatarText?: string;
}

const Header: React.FC<HeaderProps> = ({
  eyebrow,
  title,
  subtitle,
  notificationCount = 0,
  onPressNotification,
  showNotification = true,
  showAvatar = false,
  avatarUrl,
  avatarText = "",
}) => {
  const handleNotificationPress = () => {
    if (onPressNotification) {
      onPressNotification();
      return;
    }
    router.push("/(tontine)/notification");
  };

  return (
    <View className="bg-white">
      <LinearGradient
        colors={["rgba(37,62,124,0.08)", "rgba(242,107,23,0.06)", "rgba(255,255,255,0)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="px-6 pt-4 pb-4"
      >
        <View className="flex-row items-start justify-between">
          <View className="flex-1">
            {eyebrow ? (
              <Text className="text-[#64748B] text-[12px] font-extrabold tracking-widest uppercase mb-2">
                {eyebrow}
              </Text>
            ) : null}
            <View className="flex-row items-center">
              {showAvatar && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={() => router.push("/profile")}
                  className="relative mr-3"
                >
                  <View className="absolute -inset-1 border border-orange-100 rounded-full" />
                  <Avatar url={avatarUrl ?? ""} text={avatarText} width={42} height={42} />
                </TouchableOpacity>
              )}
              <View className="flex-1">
                <Text
                  className="text-[#0F172A] font-black text-[24px] leading-[32px]"
                  numberOfLines={2}
                >
                  {title}
                </Text>
              </View>
            </View>
            {subtitle ? (
              <Text className="text-slate-500 text-[12px] font-semibold mt-2">
                {subtitle}
              </Text>
            ) : null}
          </View>

          {showNotification ? (
            <TouchableOpacity
              onPress={handleNotificationPress}
              activeOpacity={0.9}
              className="relative"
              style={styles.notificationButton}
            >
              <View
                className="w-11 h-11 rounded-2xl bg-white items-center justify-center"
                style={styles.notificationButtonInner}
              >
                <Image
                  source={icons.notifications}
                  className="w-5 h-5"
                  tintColor="#253E7C"
                />
              </View>
              {notificationCount > 0 && (
                <View style={styles.notificationBadge}>
                  <View className="w-2 h-2 rounded-full bg-[#F26B17]" />
                </View>
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        <View className="mt-4 h-[1px] bg-slate-200/60" />
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  notificationButton: {
    marginTop: 4,
  },
  notificationButtonInner: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    ...Platform.select({
      ios: {
        shadowColor: "#0B1220",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
      },
      android: { elevation: 2 },
    }),
  },
  notificationBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
    ...Platform.select({
      ios: {
        shadowColor: "#F26B17",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
      },
      android: { elevation: 4 },
    }),
  },
});

export default GradientHeader;
