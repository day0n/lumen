'use client';

/**
 * 横向流水线步骤条，支持锁定、就绪、运行、成功、失败和取消状态。
 * 步骤内容由外部管理，组件只负责状态、标签、连接线与点击交互。
 */

import { IconCheck, IconLoader2, IconLock } from '@tabler/icons-react';
import { AnimatePresence, type Variants, motion } from 'motion/react';

import { cn } from '@/lib/cn';

export type PipelineStepStatus = 'locked' | 'ready' | 'running' | 'success' | 'error' | 'cancelled';

export interface PipelineStepperStep {
  label: string;
  status: PipelineStepStatus;
}

interface PipelineStepperProps {
  steps: PipelineStepperStep[];
  /** 1-based 当前活跃步骤序号（与外部 activeStep 对齐，外部用 0-based 时记得 +1）。 */
  activeStep: number;
  onStepClick: (oneBasedIndex: number) => void;
  className?: string;
}

export function PipelineStepper({
  steps,
  activeStep,
  onStepClick,
  className,
}: PipelineStepperProps) {
  return (
    <div className={cn('flex w-full items-start gap-2', className)}>
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isLast = index === steps.length - 1;
        return (
          <div key={step.label} className="flex flex-1 items-start gap-2">
            <StepIndicatorWithLabel
              stepNumber={stepNumber}
              isActive={activeStep === stepNumber}
              status={step.status}
              label={step.label}
              onClick={() => onStepClick(stepNumber)}
            />
            {!isLast ? (
              <div className="mt-3 flex-1">
                <StepConnector
                  isComplete={steps[index]!.status === 'success'}
                  isLocked={steps[index + 1]?.status === 'locked'}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface StepIndicatorWithLabelProps {
  stepNumber: number;
  isActive: boolean;
  status: PipelineStepStatus;
  label: string;
  onClick: () => void;
}

function StepIndicatorWithLabel({
  stepNumber,
  isActive,
  status,
  label,
  onClick,
}: StepIndicatorWithLabelProps) {
  const isLocked = status === 'locked';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLocked}
      aria-current={isActive ? 'step' : undefined}
      className={cn(
        'group/step flex min-w-0 flex-col items-center gap-1.5 outline-none',
        isLocked ? 'cursor-not-allowed opacity-55' : 'cursor-pointer',
      )}
    >
      <CircleIndicator
        stepNumber={stepNumber}
        isActive={isActive}
        status={status}
        isLocked={isLocked}
      />
      <span
        className={cn(
          'max-w-[120px] truncate text-[11px] font-bold transition-colors',
          isActive ? 'text-white' : isLocked ? 'text-white/30' : 'text-white/56',
          !isLocked && !isActive && 'group-hover/step:text-white/82',
        )}
      >
        {label}
      </span>
    </button>
  );
}

interface CircleIndicatorProps {
  stepNumber: number;
  isActive: boolean;
  status: PipelineStepStatus;
  isLocked: boolean;
}

function CircleIndicator({ stepNumber, isActive, status, isLocked }: CircleIndicatorProps) {
  // 颜色风格表 —— 跟 lumen 的现有主色对齐：
  // active=白；success=#3ae08a（绿）；running=#79e4ff（青）；error=#f5c76a（黄）。
  const variantKey: keyof typeof circleVariants = isLocked
    ? 'locked'
    : isActive
      ? 'active'
      : status === 'success'
        ? 'success'
        : status === 'running'
          ? 'running'
          : status === 'error'
            ? 'error'
            : 'ready';

  return (
    <motion.div
      animate={variantKey}
      initial={false}
      variants={circleVariants}
      transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ring-1"
    >
      <AnimatePresence mode="wait" initial={false}>
        {isLocked ? (
          <motion.span
            key="lock"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.18 }}
          >
            <IconLock size={11} stroke={2.4} />
          </motion.span>
        ) : status === 'running' ? (
          <motion.span
            key="run"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <IconLoader2 size={12} className="animate-spin" />
          </motion.span>
        ) : status === 'success' && !isActive ? (
          <motion.svg
            key="check"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
            role="img"
            aria-label="Step complete"
          >
            <motion.path
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.05, duration: 0.3, ease: 'easeOut' }}
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </motion.svg>
        ) : isActive ? (
          <motion.span
            key="active"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ duration: 0.18 }}
            className="block h-2 w-2 rounded-full bg-white"
          />
        ) : (
          <motion.span
            key={`num-${stepNumber}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {stepNumber}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const circleVariants: Variants = {
  locked: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.32)',
    boxShadow: '0 0 0 0 rgba(255,255,255,0)',
    // ring color via box-shadow
  },
  ready: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.62)',
  },
  active: {
    backgroundColor: '#ffffff',
    color: '#111315',
    boxShadow: '0 8px 24px -12px rgba(255,255,255,0.6)',
  },
  success: {
    backgroundColor: 'rgba(58,224,138,0.18)',
    color: '#86efac',
  },
  running: {
    backgroundColor: 'rgba(121,228,255,0.18)',
    color: '#79e4ff',
  },
  error: {
    backgroundColor: 'rgba(245,199,106,0.18)',
    color: '#f5c76a',
  },
};

interface StepConnectorProps {
  isComplete: boolean;
  isLocked: boolean;
}

function StepConnector({ isComplete, isLocked }: StepConnectorProps) {
  return (
    <div className="relative h-0.5 w-full overflow-hidden rounded bg-white/[0.06]">
      <motion.div
        initial={false}
        animate={{
          width: isComplete ? '100%' : '0%',
          backgroundColor: isLocked ? 'rgba(255,255,255,0.06)' : 'rgba(58,224,138,0.6)',
        }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="absolute inset-y-0 left-0"
      />
    </div>
  );
}
