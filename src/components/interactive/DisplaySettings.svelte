<script lang="ts">
import Icon from "@iconify/svelte";
import { onMount } from "svelte";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { mouseTrailConfig, sakuraConfig } from "@/config";
import {
	getDefaultHue,
	getHue,
	setHue,
} from "@utils/setting-utils";
import {
	isSakuraEnabled,
	isTrailEnabled,
} from "@utils/effect-utils";

let hue = getHue();
const defaultHue = getDefaultHue();

function resetHue() {
	hue = getDefaultHue();
}

$: if (hue || hue === 0) {
	setHue(hue);
}

// 特效开关状态（默认值来自配置文件，若 localStorage 已有则覆盖）
let sakuraOn = isSakuraEnabled(sakuraConfig);
let trailOn = isTrailEnabled(mouseTrailConfig);

// 樱花特效开关：默认值由配置决定
// 拖尾特效开关：默认值由配置决定

function toggleSakura() {
	sakuraOn = !sakuraOn;
	// 持久化 + 通知特效组件
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("sakura-toggle"));
	}
}

function toggleTrail() {
	trailOn = !trailOn;
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent("trail-toggle"));
	}
}

onMount(() => {
	// 确保面板状态与 localStorage 一致（例如其它页面已切换）
	sakuraOn = isSakuraEnabled(sakuraConfig);
	trailOn = isTrailEnabled(mouseTrailConfig);
});
</script>

<div id="display-setting" class="float-panel float-panel-closed absolute transition-all w-80 right-4 px-4 py-4">
    <div class="flex flex-row gap-2 mb-3 items-center justify-between">
        <div class="flex gap-2 font-bold text-lg text-neutral-900 dark:text-neutral-100 transition relative ml-3
            before:w-1 before:h-4 before:rounded-md before:bg-[var(--primary)]
            before:absolute before:-left-3 before:top-[0.33rem]"
        >
            {i18n(I18nKey.themeColor)}
            <button aria-label="Reset to Default" class="btn-regular w-7 h-7 rounded-md  active:scale-90"
                    class:opacity-0={hue === defaultHue} class:pointer-events-none={hue === defaultHue} onclick={resetHue}>
                <div class="text-[var(--btn-content)]">
                    <Icon icon="fa6-solid:arrow-rotate-left" class="text-[0.875rem]"></Icon>
                </div>
            </button>
        </div>
        <div class="flex gap-1">
            <div id="hueValue" class="transition bg-[var(--btn-regular-bg)] w-10 h-7 rounded-md flex justify-center
            font-bold text-sm items-center text-[var(--btn-content)]">
                {hue}
            </div>
        </div>
    </div>
    <div class="w-full h-6 px-1 bg-[oklch(0.80_0.10_0)] dark:bg-[oklch(0.70_0.10_0)] rounded select-none">
        <input aria-label={i18n(I18nKey.themeColor)} type="range" min="0" max="360" bind:value={hue}
               class="slider" id="colorSlider" step="5" style="width: 100%">
    </div>

    <!-- 特效开关区块 -->
    <div class="mt-4 pt-3 border-t border-[var(--line-divider)]">
        <div class="flex flex-row items-center justify-between mb-2">
            <span class="font-bold text-base text-neutral-900 dark:text-neutral-100 ml-1">
                {i18n(I18nKey.effects)}
            </span>
        </div>

        {#if sakuraConfig.enable && sakuraConfig.switchable}
            <label class="flex flex-row items-center justify-between px-2 py-2 rounded-lg hover:bg-[var(--btn-plain-bg-hover)] cursor-pointer transition">
                <span class="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                    <Icon icon="material-symbols:spa-outline" class="text-[1.1rem] text-[var(--primary)]"></Icon>
                    {i18n(I18nKey.sakuraEffect)}
                </span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={sakuraOn}
                    aria-label={i18n(I18nKey.sakuraEffect)}
                    class="relative w-11 h-6 rounded-full transition-colors"
                    class:bg-[var(--primary)]={sakuraOn}
                    class:bg-[var(--btn-regular-bg)]={!sakuraOn}
                    onclick={toggleSakura}
                >
                    <span class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                          class:left-[calc(100%-1.375rem)]={sakuraOn}
                          class:left-0.5={!sakuraOn}
                    ></span>
                </button>
            </label>
        {/if}

        {#if mouseTrailConfig.enable && mouseTrailConfig.switchable}
            <label class="flex flex-row items-center justify-between px-2 py-2 rounded-lg hover:bg-[var(--btn-plain-bg-hover)] cursor-pointer transition">
                <span class="flex items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200">
                    <Icon icon="material-symbols:gesture-outline" class="text-[1.1rem] text-[var(--primary)]"></Icon>
                    {i18n(I18nKey.mouseTrailEffect)}
                </span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={trailOn}
                    aria-label={i18n(I18nKey.mouseTrailEffect)}
                    class="relative w-11 h-6 rounded-full transition-colors"
                    class:bg-[var(--primary)]={trailOn}
                    class:bg-[var(--btn-regular-bg)]={!trailOn}
                    onclick={toggleTrail}
                >
                    <span class="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
                          class:left-[calc(100%-1.375rem)]={trailOn}
                          class:left-0.5={!trailOn}
                    ></span>
                </button>
            </label>
        {/if}
    </div>
</div>


<style lang="stylus">
    #display-setting
      input[type="range"]
        -webkit-appearance none
        height 1.5rem
        background-image var(--color-selection-bar)
        transition background-image 0.15s ease-in-out

        /* Input Thumb */
        &::-webkit-slider-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-moz-range-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          border-width 0
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

        &::-ms-thumb
          -webkit-appearance none
          height 1rem
          width 0.5rem
          border-radius 0.125rem
          background rgba(255, 255, 255, 0.7)
          box-shadow none
          &:hover
            background rgba(255, 255, 255, 0.8)
          &:active
            background rgba(255, 255, 255, 0.6)

</style>
