import { useId } from 'react';
import { Field, Input, Select } from '../ui';
import { fmt } from '../../lib/paths';

/** What the app knows about bottles per batch and stage, in the user's zones. */
export interface KnownBatch {
  batchId: number;
  batchCode: string;
  stages: { code: string; bottles: number; trays: number }[];
}

export const sameCode = (a: string, b: string) => a.trim().toUpperCase().replace(/\s+/g, '') === b.trim().toUpperCase().replace(/\s+/g, '');

/**
 * Batch and stage typed in (with suggestions), so work can be given or recorded for a batch the app
 * does not have yet. A new batch asks for its crop and is added when the form is saved.
 */
export function BatchStageFields({ batchCode, stageCode, cropId, onChange, allBatches, known, stageCodes, crops, disabled = false }: {
  batchCode: string;
  stageCode: string;
  cropId: number | null;
  onChange: (v: { batchCode?: string; stageCode?: string; cropId?: number | null }) => void;
  allBatches: { batchCode: string }[];
  known: KnownBatch[];
  stageCodes: string[];
  crops: { cropId: number; name: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  const typedBatch = batchCode.trim().length >= 2;
  const isNew = typedBatch && !allBatches.some((b) => sameCode(b.batchCode, batchCode));
  const kb = known.find((b) => sameCode(b.batchCode, batchCode));
  const st = kb?.stages.find((s) => sameCode(s.code, stageCode));
  const stageOk = !stageCode.trim() || stageCodes.some((c) => sameCode(c, stageCode));
  // Suggest the stages that batch has bottles at first, then the rest.
  const stageList = [...(kb?.stages.map((s) => s.code) ?? []), ...stageCodes.filter((c) => !kb?.stages.some((s) => s.code === c))];

  const stageHint = !stageOk
    ? <span className="text-redx-700">Not in the stage list.</span>
    : !typedBatch || !stageCode.trim() ? undefined
      : st ? `${fmt(st.bottles)} bottles in ${st.trays} tray${st.trays === 1 ? '' : 's'}`
        : isNew ? 'Counted from this work' : 'No bottles recorded here yet';

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Batch" hint={isNew ? <span className="text-amberx-700">New batch: it will be added.</span> : kb ? `Has bottles at ${kb.stages.map((s) => s.code).join(', ')}` : typedBatch ? 'No bottles recorded in your zones' : 'For example B1-26'}>
          <Input value={batchCode} list={`${id}-b`} disabled={disabled} autoCapitalize="characters" autoComplete="off" placeholder="B1-26" onChange={(e) => onChange({ batchCode: e.target.value })} />
          <datalist id={`${id}-b`}>{allBatches.map((b) => <option key={b.batchCode} value={b.batchCode} />)}</datalist>
        </Field>
        <Field label="Stage" hint={stageHint}>
          <Input value={stageCode} list={`${id}-s`} disabled={disabled} autoCapitalize="characters" autoComplete="off" placeholder="M6" onChange={(e) => onChange({ stageCode: e.target.value })} />
          <datalist id={`${id}-s`}>{stageList.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
      </div>
      {isNew && !disabled && (
        <Field label="Crop of the new batch">
          <Select value={cropId ?? ''} onChange={(e) => onChange({ cropId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Choose the crop</option>
            {crops.map((c) => <option key={c.cropId} value={c.cropId}>{c.name}</option>)}
          </Select>
        </Field>
      )}
    </>
  );
}
