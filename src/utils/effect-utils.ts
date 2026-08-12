import type { MouseTrailConfig, SakuraConfig } from "../types/config";

// 特效启用的 localStorage key
export const SAKURA_ENABLED_KEY = "sakuraEnabled";
export const TRAIL_ENABLED_KEY = "trailEnabled";

// 读取樱花特效的启用状态（优先 localStorage，其次配置默认值）
export function isSakuraEnabled(config: SakuraConfig): boolean {
	if (typeof localStorage === "undefined") {
		return config.enable;
	}
	const stored = localStorage.getItem(SAKURA_ENABLED_KEY);
	if (stored === null) {
		return config.enable;
	}
	return stored === "true";
}

// 持久化樱花特效的启用状态
export function setSakuraEnabled(enabled: boolean): void {
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(SAKURA_ENABLED_KEY, String(enabled));
	}
}

// 读取鼠标拖尾特效的启用状态（优先 localStorage，其次配置默认值）
export function isTrailEnabled(config: MouseTrailConfig): boolean {
	if (typeof localStorage === "undefined") {
		return config.enable;
	}
	const stored = localStorage.getItem(TRAIL_ENABLED_KEY);
	if (stored === null) {
		return config.enable;
	}
	return stored === "true";
}

// 持久化鼠标拖尾特效的启用状态
export function setTrailEnabled(enabled: boolean): void {
	if (typeof localStorage !== "undefined") {
		localStorage.setItem(TRAIL_ENABLED_KEY, String(enabled));
	}
}
