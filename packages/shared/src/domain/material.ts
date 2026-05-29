import { z } from 'zod';

export const MaterialTypeSchema = z.enum(['image', 'video', 'video_slice', 'audio']);
export type MaterialType = z.infer<typeof MaterialTypeSchema>;

export const MaterialSourceSchema = z.enum(['builtin', 'user_upload']);
export type MaterialSource = z.infer<typeof MaterialSourceSchema>;

export const MaterialSchema = z.object({
  id: z.string(),
  type: MaterialTypeSchema,
  source: MaterialSourceSchema,
  userId: z.string().optional(),
  fileKey: z.string(),
  cdnUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  category: z.string().optional(),
  duration: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  parentVideoId: z.string().optional(),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  createdAt: z.string().datetime(),
});
export type Material = z.infer<typeof MaterialSchema>;
