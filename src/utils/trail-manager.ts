import type { MouseTrailConfig } from "../types/config";
import {
	isTrailEnabled,
	setTrailEnabled,
} from "./effect-utils";

// 拖尾粒子类
class TrailParticle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	size: number;
	alpha: number;
	config: MouseTrailConfig;

	constructor(x: number, y: number, config: MouseTrailConfig) {
		this.x = x;
		this.y = y;
		const angle = Math.random() * Math.PI * 2;
		const speed =
			config.speed.min +
			Math.random() * (config.speed.max - config.speed.min);
		this.vx = Math.cos(angle) * speed;
		this.vy = Math.sin(angle) * speed;
		this.size =
			config.size.min +
			Math.random() * (config.size.max - config.size.min);
		this.alpha = config.opacity.start;
		this.config = config;
	}

	update() {
		this.x += this.vx;
		this.y += this.vy;
		// 轻微减速，形成自然扩散
		this.vx *= 0.96;
		this.vy *= 0.96;
		this.alpha -= this.config.fadeSpeed;
	}

	draw(ctx: CanvasRenderingContext2D, hue: number) {
		const alpha = Math.max(
			this.config.opacity.end,
			Math.min(this.config.opacity.start, this.alpha),
		);
		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.fillStyle = `hsl(${hue} 80% 65%)`;
		ctx.beginPath();
		ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
	}

	get isAlive(): boolean {
		return this.alpha > this.config.opacity.end && this.size > 0.5;
	}
}

// 鼠标拖尾管理器类
export class MouseTrailManager {
	private config: MouseTrailConfig;
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private particles: TrailParticle[] = [];
	private animationId: number | null = null;
	private isRunning = false;
	private mouseX = 0;
	private mouseY = 0;
	private lastEmit = 0;
	private handleMouseMove: ((e: MouseEvent) => void) | null = null;
	private handleResize: (() => void) | null = null;

	constructor(config: MouseTrailConfig) {
		this.config = config;
	}

	// 初始化鼠标拖尾特效
	init(): void {
		if (this.isRunning) {
			return;
		}
		// 触摸设备自动禁用（手机上鼠标拖尾没有意义）
		if (window.matchMedia("(pointer: coarse)").matches) {
			return;
		}

		this.createCanvas();

		this.handleMouseMove = (e: MouseEvent) => {
			this.mouseX = e.clientX;
			this.mouseY = e.clientY;
			this.emitParticles();
		};
		window.addEventListener("mousemove", this.handleMouseMove);

		this.handleResize = () => {
			if (this.canvas) {
				this.canvas.width = window.innerWidth;
				this.canvas.height = window.innerHeight;
			}
		};
		window.addEventListener("resize", this.handleResize);

		this.startAnimation();
		this.isRunning = true;
	}

	// 创建画布
	private createCanvas(): void {
		this.canvas = document.createElement("canvas");
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
		this.canvas.setAttribute(
			"style",
			`position: fixed; left: 0; top: 0; pointer-events: none; z-index: ${this.config.zIndex};`,
		);
		this.canvas.setAttribute("id", "canvas_mouse_trail");
		document.body.appendChild(this.canvas);
		this.ctx = this.canvas.getContext("2d");
	}

	// 在鼠标位置生成粒子
	private emitParticles(): void {
		if (!this.ctx) {
			return;
		}
		const now = Date.now();
		// 限制生成频率，避免粒子过多
		if (now - this.lastEmit < 30) {
			return;
		}
		this.lastEmit = now;

		// 每次移动生成 1-3 个粒子
		const count = Math.floor(Math.random() * 3) + 1;
		for (let i = 0; i < count; i++) {
			if (this.particles.length >= this.config.particleCount) {
				this.particles.shift();
			}
			this.particles.push(
				new TrailParticle(this.mouseX, this.mouseY, this.config),
			);
		}
	}

	// 开始动画循环
	private startAnimation(): void {
		if (!this.ctx || !this.canvas) {
			return;
		}

		const animate = () => {
			if (!this.ctx || !this.canvas) {
				return;
			}

			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

			// 获取当前主题色相
			const hue = Number.parseInt(
				document.documentElement.style.getPropertyValue("--hue") || "165",
				10,
			);

			this.particles = this.particles.filter((p) => p.isAlive);
			for (const p of this.particles) {
				p.update();
				p.draw(this.ctx, hue);
			}

			this.animationId = requestAnimationFrame(animate);
		};

		this.animationId = requestAnimationFrame(animate);
	}

	// 停止鼠标拖尾特效
	stop(): void {
		if (this.animationId) {
			cancelAnimationFrame(this.animationId);
			this.animationId = null;
		}

		if (this.handleMouseMove) {
			window.removeEventListener("mousemove", this.handleMouseMove);
			this.handleMouseMove = null;
		}
		if (this.handleResize) {
			window.removeEventListener("resize", this.handleResize);
			this.handleResize = null;
		}

		if (this.canvas) {
			document.body.removeChild(this.canvas);
			this.canvas = null;
			this.ctx = null;
		}

		this.particles = [];
		this.isRunning = false;
	}

	// 获取运行状态
	getIsRunning(): boolean {
		return this.isRunning;
	}
}

// 创建全局鼠标拖尾管理器实例
let globalTrailManager: MouseTrailManager | null = null;

// 初始化鼠标拖尾特效（尊重 localStorage 的启用状态）
export function initTrail(config: MouseTrailConfig): void {
	if (!config.enable) {
		return;
	}
	if (!isTrailEnabled(config)) {
		return;
	}
	if (globalTrailManager) {
		globalTrailManager.stop();
		globalTrailManager = null;
	}
	globalTrailManager = new MouseTrailManager(config);
	globalTrailManager.init();
}

// 切换鼠标拖尾特效（切换时同时持久化到 localStorage）
export function toggleTrail(config: MouseTrailConfig): void {
	if (globalTrailManager?.getIsRunning()) {
		globalTrailManager.stop();
		globalTrailManager = null;
		setTrailEnabled(false);
	} else {
		setTrailEnabled(true);
		initTrail(config);
	}
}

// 停止鼠标拖尾特效
export function stopTrail(): void {
	if (globalTrailManager) {
		globalTrailManager.stop();
		globalTrailManager = null;
	}
}

// 获取鼠标拖尾运行状态
export function getTrailStatus(): boolean {
	return globalTrailManager ? globalTrailManager.getIsRunning() : false;
}
