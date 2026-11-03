import type { EntityConfig } from './config.js';
import type { ReportPresentation } from './money-display.js';

export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
    .replace(/\b(id|eta|api|csv|sql|tms|po|edi|utc|usd)\b/gi, (word) => word.toUpperCase());
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Whole row';
}

export function reportLabels(presentation: ReportPresentation) {
  const entity = (name: string) => presentation.entities?.find((item) => item.name === name);
  return {
    entity,
    source: (name: string, source: string) => entity(name)?.sources[source]?.label ?? humanize(source),
    field(name: string, field: string, aggregate = false): string {
      if (field.includes(', '))
        return field
          .split(', ')
          .map((part) => reportLabels(presentation).field(name, part, aggregate))
          .join(', ');
      const definition = entity(name);
      if (aggregate) return definition?.aggregates.find((item) => item.name === field)?.label ?? humanize(field);
      for (const source of Object.values(definition?.sources ?? {})) {
        const mapping = source.fields[field];
        if (typeof mapping === 'object' && mapping.label) return mapping.label;
      }
      return humanize(field);
    },
    all: (name: string) => `All ${entity(name)?.pluralLabel ?? 'records'}`,
  };
}

export function presentationRule(entity: EntityConfig | undefined, field: string, aggregate: boolean) {
  const definition = aggregate ? entity?.aggregates.find((item) => item.name === field) : undefined;
  return aggregate && definition?.type !== 'sum'
    ? undefined
    : entity?.compare[definition?.type === 'sum' ? definition.field : field];
}
