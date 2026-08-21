import { NextResponse } from 'next/server';

interface RawCountry {
  name: string;
  dial_code: string;
  code: string;
}

interface CountriesApiResponse {
  error: boolean;
  data: RawCountry[];
}

export async function GET() {
  try {
    const res = await fetch('https://countriesnow.space/api/v0.1/countries/codes', {
      next: { revalidate: 86400 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Upstream error ${res.status}` }, { status: 502 });
    }

    const json: CountriesApiResponse = await res.json();

    const countries = json.data
      .filter((c) => c.name && c.dial_code?.startsWith('+'))
      .map((c) => ({
        name: c.name,
        dialCode: c.dial_code.trim(),
        flag: '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Pin India at top
    const indiaIdx = countries.findIndex((c) => c.name === 'India');
    if (indiaIdx > 0) {
      const [india] = countries.splice(indiaIdx, 1);
      countries.unshift(india);
    }

    return NextResponse.json(countries, {
      headers: { 'Cache-Control': 'public, max-age=86400' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}