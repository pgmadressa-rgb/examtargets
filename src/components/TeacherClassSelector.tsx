import React, { useMemo } from 'react';
import { groupPlansByTeacher, normalizeTeacherKey } from '../shared/planEngine.ts';
import type { ClassPlan } from '../shared/types.ts';

interface TeacherClassSelectorProps {
  plans: ClassPlan[];
  selectedPlanId: string;
  onSelectPlanId: (planId: string) => void;
  /** Optional "All Teachers" option (e.g. for Admin directory filtering) */
  selectedTeacherKey?: string;
  onSelectTeacherKey?: (teacherKey: string) => void;
  allowAllTeachers?: boolean;
  idPrefix?: string;
  compact?: boolean;
}

export const TeacherClassSelector: React.FC<TeacherClassSelectorProps> = ({
  plans,
  selectedPlanId,
  onSelectPlanId,
  selectedTeacherKey,
  onSelectTeacherKey,
  allowAllTeachers = false,
  idPrefix = 'tc',
  compact = false,
}) => {
  const teacherGroups = useMemo(() => groupPlansByTeacher(plans), [plans]);

  const activePlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? plans[0] ?? null,
    [plans, selectedPlanId]
  );

  const effectiveTeacherKey = useMemo(() => {
    if (allowAllTeachers && selectedTeacherKey === 'all') return 'all';
    if (selectedTeacherKey && teacherGroups.some((g) => g.teacherKey === selectedTeacherKey)) {
      return selectedTeacherKey;
    }
    if (activePlan) {
      return normalizeTeacherKey(activePlan.teacherName);
    }
    return teacherGroups[0]?.teacherKey ?? '';
  }, [allowAllTeachers, selectedTeacherKey, teacherGroups, activePlan]);

  const activeTeacherGroup = useMemo(
    () => teacherGroups.find((g) => g.teacherKey === effectiveTeacherKey) ?? null,
    [teacherGroups, effectiveTeacherKey]
  );

  const classOptions = useMemo(() => {
    if (effectiveTeacherKey === 'all') return plans;
    return activeTeacherGroup?.plans ?? plans;
  }, [effectiveTeacherKey, activeTeacherGroup, plans]);

  const handleTeacherChange = (nextKey: string) => {
    onSelectTeacherKey?.(nextKey);
    if (nextKey === 'all') return;
    const group = teacherGroups.find((g) => g.teacherKey === nextKey);
    if (group && group.plans.length > 0) {
      const alreadyInGroup = group.plans.some((p) => p.id === selectedPlanId);
      if (!alreadyInGroup) {
        onSelectPlanId(group.plans[0].id);
      }
    }
  };

  if (plans.length === 0) return null;

  const selectClassName = compact
    ? 'min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none'
    : 'min-h-[40px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-900 focus:border-teal-700 focus:bg-white focus:outline-none';

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label
          htmlFor={`${idPrefix}-teacher-select`}
          className="block text-xs font-medium text-slate-600 mb-1"
        >
          Teacher (Ustadh / Apa)
        </label>
        <select
          id={`${idPrefix}-teacher-select`}
          value={effectiveTeacherKey}
          onChange={(e) => handleTeacherChange(e.target.value)}
          className={selectClassName}
        >
          {allowAllTeachers && (
            <option value="all">All Teachers ({plans.length} classes)</option>
          )}
          {teacherGroups.map((g) => (
            <option key={g.teacherKey} value={g.teacherKey}>
              {g.teacherName}
              {g.plans.length > 1 ? ` (${g.plans.length} classes)` : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor={`${idPrefix}-class-subselect`}
          className="block text-xs font-medium text-slate-600 mb-1"
        >
          Class Sub-Selector
          {activeTeacherGroup && activeTeacherGroup.plans.length > 1
            ? ` (${activeTeacherGroup.plans.length} classes)`
            : ''}
        </label>
        <select
          id={`${idPrefix}-class-subselect`}
          value={
            classOptions.some((p) => p.id === selectedPlanId)
              ? selectedPlanId
              : classOptions[0]?.id ?? ''
          }
          onChange={(e) => onSelectPlanId(e.target.value)}
          className={selectClassName}
        >
          {classOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {effectiveTeacherKey === 'all'
                ? `${p.className} — ${p.teacherName}`
                : `${p.className} (${p.trackType})`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
