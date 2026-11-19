import { z } from 'zod';
import { ToolError, defineTool } from './types';

interface Unit {
  dimension: string;
  /** Multiply by this to reach the dimension's base unit. */
  factor: number;
  label: string;
}

const UNITS = new Map<string, Unit>();

function add(dimension: string, label: string, factor: number, names: string[]) {
  for (const name of names) UNITS.set(name, { dimension, factor, label });
}

add('length', 'mm', 0.001, ['mm', 'millimeter', 'millimeters', 'millimetre', 'millimetres']);
add('length', 'cm', 0.01, ['cm', 'centimeter', 'centimeters', 'centimetre', 'centimetres']);
add('length', 'm', 1, ['m', 'meter', 'meters', 'metre', 'metres']);
add('length', 'km', 1000, ['km', 'kilometer', 'kilometers', 'kilometre', 'kilometres']);
add('length', 'in', 0.0254, ['in', 'inch', 'inches']);
add('length', 'ft', 0.3048, ['ft', 'foot', 'feet']);
add('length', 'yd', 0.9144, ['yd', 'yard', 'yards']);
add('length', 'mi', 1609.344, ['mi', 'mile', 'miles']);
add('mass', 'mg', 0.000001, ['mg', 'milligram', 'milligrams']);
add('mass', 'g', 0.001, ['g', 'gram', 'grams']);
add('mass', 'kg', 1, ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos']);
add('mass', 't', 1000, ['t', 'tonne', 'tonnes']);
add('mass', 'oz', 0.028349523125, ['oz', 'ounce', 'ounces']);
add('mass', 'lb', 0.45359237, ['lb', 'lbs', 'pound', 'pounds']);
add('mass', 'st', 6.35029318, ['st', 'stone']);
add('volume', 'ml', 0.001, ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres']);
add('volume', 'l', 1, ['l', 'liter', 'liters', 'litre', 'litres']);
add('volume', 'tsp', 0.00492892159375, ['tsp', 'teaspoon', 'teaspoons']);
add('volume', 'tbsp', 0.01478676478125, ['tbsp', 'tablespoon', 'tablespoons']);
add('volume', 'fl oz', 0.0295735295625, ['floz', 'fl oz', 'fluid ounce', 'fluid ounces']);
add('volume', 'cup', 0.2365882365, ['cup', 'cups']);
add('volume', 'pt', 0.473176473, ['pt', 'pint', 'pints']);
add('volume', 'gal', 3.785411784, ['gal', 'gallon', 'gallons']);
add('speed', 'm/s', 1, ['m/s', 'mps']);
add('speed', 'km/h', 1 / 3.6, ['km/h', 'kmh', 'kph']);
add('speed', 'mph', 0.44704, ['mph', 'mi/h']);
add('speed', 'kn', 0.514444444, ['kn', 'knot', 'knots']);
add('time', 'ms', 0.001, ['ms', 'millisecond', 'milliseconds']);
add('time', 's', 1, ['s', 'sec', 'second', 'seconds']);
add('time', 'min', 60, ['min', 'minute', 'minutes']);
add('time', 'h', 3600, ['h', 'hr', 'hour', 'hours']);
add('time', 'd', 86_400, ['d', 'day', 'days']);
add('time', 'wk', 604_800, ['wk', 'week', 'weeks']);
add('data', 'B', 1, ['b', 'byte', 'bytes']);
add('data', 'KB', 1000, ['kb', 'kilobyte', 'kilobytes']);
add('data', 'MB', 1_000_000, ['mb', 'megabyte', 'megabytes']);
add('data', 'GB', 1_000_000_000, ['gb', 'gigabyte', 'gigabytes']);
add('data', 'TB', 1_000_000_000_000, ['tb', 'terabyte', 'terabytes']);
add('data', 'KiB', 1024, ['kib', 'kibibyte', 'kibibytes']);
add('data', 'MiB', 1024 ** 2, ['mib', 'mebibyte', 'mebibytes']);
add('data', 'GiB', 1024 ** 3, ['gib', 'gibibyte', 'gibibytes']);

const TEMPERATURES = new Map([
  ['c', 'C'],
  ['celsius', 'C'],
  ['°c', 'C'],
  ['f', 'F'],
  ['fahrenheit', 'F'],
  ['°f', 'F'],
  ['k', 'K'],
  ['kelvin', 'K'],
]);

function toCelsius(value: number, unit: string): number {
  if (unit === 'F') return ((value - 32) * 5) / 9;
  if (unit === 'K') return value - 273.15;
  return value;
}

function fromCelsius(value: number, unit: string): number {
  if (unit === 'F') return (value * 9) / 5 + 32;
  if (unit === 'K') return value + 273.15;
  return value;
}

function round(value: number): number {
  return Number(value.toPrecision(10));
}

export const convertUnits = defineTool({
  name: 'convert_units',
  description:
    'Convert a value between units of length, mass, volume, speed, time, data size or temperature (C, F, K). Volumes are US customary.',
  sideEffect: false,
  schema: z.object({
    value: z.number().finite(),
    from: z.string().min(1).max(30).describe('For example km, miles, lb, cups, F'),
    to: z.string().min(1).max(30),
  }),
  run: ({ value, from, to }) => {
    const fromKey = from.trim().toLowerCase();
    const toKey = to.trim().toLowerCase();
    const fromTemp = TEMPERATURES.get(fromKey);
    const toTemp = TEMPERATURES.get(toKey);

    if (fromTemp && toTemp) {
      return {
        value,
        from: fromTemp,
        to: toTemp,
        result: round(fromCelsius(toCelsius(value, fromTemp), toTemp)),
      };
    }

    const source = UNITS.get(fromKey);
    const target = UNITS.get(toKey);
    if (!source) throw new ToolError(`Unknown unit "${from}".`);
    if (!target) throw new ToolError(`Unknown unit "${to}".`);
    if (source.dimension !== target.dimension)
      throw new ToolError(
        `Cannot convert ${source.dimension} (${source.label}) to ${target.dimension} (${target.label}).`,
      );
    return {
      value,
      from: source.label,
      to: target.label,
      result: round((value * source.factor) / target.factor),
    };
  },
});
