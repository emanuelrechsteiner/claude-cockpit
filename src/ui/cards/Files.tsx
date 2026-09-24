import React from 'react';
import { Text } from 'ink';
import type { FileItem } from '../../types.js';
import { osc8 } from '../../osc8.js';
import { sortFiles } from '../activate.js';

export function Files(props: { data: FileItem[]; focused: boolean; cursor: number }) {
  if (props.data.length === 0) return <Text dimColor>noch keine Dateien</Text>;
  // Dieselbe Sortierung, die auch die Enter-Taste benutzt (activate.ts) —
  // getrennte Kopien würden auseinanderlaufen und die falsche Datei öffnen.
  const shown = sortFiles(props.data).slice(0, 8);
  return (
    <>
      {shown.map((f, i) => (
        <Text key={f.path} inverse={props.focused && i === props.cursor}>
          {f.origin === 'candidate' ? '★' : '·'} {osc8(`file://${f.path}`, f.path.split('/').pop() ?? f.path)}
        </Text>
      ))}
    </>
  );
}
