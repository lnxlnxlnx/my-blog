import type { MouseTrailConfig } from "../types/config";

// 鼠标拖尾特效配置
export const mouseTrailConfig: MouseTrailConfig = {
	enable: true, // 默认开启鼠标拖尾特效
	switchable: true, // 允许访客在前台开关鼠标拖尾特效
	particleCount: 20, // 粒子数量
	size: {
		min: 3, // 粒子最小尺寸（px）
		max: 8, // 粒子最大尺寸（px）
	},
	speed: {
		min: 0.5, // 粒子最小扩散速度
		max: 1.5, // 粒子最大扩散速度
	},
	opacity: {
		start: 0.9, // 粒子起始不透明度
		end: 0, // 粒子最终不透明度
	},
	fadeSpeed: 0.03, // 粒子淡出速度
	zIndex: 95, // 层级（低于樱花 100）
};
