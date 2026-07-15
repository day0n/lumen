'use client';

import { createContext } from 'react';

/**
 * 画布缩放分级（Level of Detail）。
 * true 表示当前缩放低于阈值（整图概览态），此时节点细节过小难以辨认，
 * 节点会改渲一个只含大号标题 + 类型色点的简化视图，保证缩到很小也能一眼看清。
 *
 * 该值由 CanvasWorkbench 顶层用 useStore 订阅 zoom 派生，且只在「跨过阈值」时翻转，
 * 所以节点只在概览态与细节态之间切换时重渲一次，不会随每一帧缩放抖动。
 */
export const CanvasLodContext = createContext(false);

export const CANVAS_LOD_ZOOM_THRESHOLD = 0.6;
