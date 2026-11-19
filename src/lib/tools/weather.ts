import { z } from 'zod';
import { ToolError, defineTool, sleep } from './types';

interface Sample {
  city: string;
  temperatureC: number;
  condition: string;
  windKmh: number;
  humidityPercent: number;
}

const SAMPLES: readonly Sample[] = [
  {
    city: 'Amsterdam',
    temperatureC: 9,
    condition: 'Overcast with light rain',
    windKmh: 22,
    humidityPercent: 86,
  },
  { city: 'Oslo', temperatureC: 2, condition: 'Clear and cold', windKmh: 9, humidityPercent: 71 },
  {
    city: 'Istanbul',
    temperatureC: 16,
    condition: 'Partly cloudy',
    windKmh: 18,
    humidityPercent: 64,
  },
  { city: 'Lisbon', temperatureC: 19, condition: 'Sunny', windKmh: 14, humidityPercent: 58 },
  { city: 'Tokyo', temperatureC: 14, condition: 'Cloudy', windKmh: 11, humidityPercent: 62 },
  {
    city: 'New York',
    temperatureC: 7,
    condition: 'Windy and bright',
    windKmh: 31,
    humidityPercent: 49,
  },
  { city: 'Cape Town', temperatureC: 24, condition: 'Sunny', windKmh: 27, humidityPercent: 55 },
  {
    city: 'Reykjavik',
    temperatureC: -1,
    condition: 'Snow showers',
    windKmh: 35,
    humidityPercent: 80,
  },
];

export const lookupWeather = defineTool({
  name: 'lookup_weather',
  description:
    'Look up the current weather for a city. The data is a fixed sample for a handful of cities, not a live forecast, so say that it is sample data when you report it.',
  sideEffect: false,
  schema: z.object({ city: z.string().min(1).max(60) }),
  run: async ({ city }, ctx) => {
    if (ctx.simulateLatency) await sleep(500, ctx.signal);
    const sample = SAMPLES.find((entry) => entry.city.toLowerCase() === city.trim().toLowerCase());
    if (!sample)
      throw new ToolError(
        `No sample data for "${city}". Sample cities: ${SAMPLES.map((entry) => entry.city).join(', ')}.`,
      );
    return { ...sample, sample: true, notice: 'Sample data, not a live forecast.' };
  },
});
