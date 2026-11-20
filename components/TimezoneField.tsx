'use client'
import { useEffect, useState } from 'react'

const COMMON = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Phoenix',
  'Pacific/Honolulu',
  'America/Anchorage',
  'Europe/London',
  'Asia/Kolkata',
]

export function TimezoneField() {
  const [tz, setTz] = useState('America/Los_Angeles')
  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (local) setTz(local)
  }, [])
  const options = COMMON.includes(tz) ? COMMON : [tz, ...COMMON]
  return (
    <label className="field">
      Where are the appointments?
      <span className="hint">Times are shown in this time zone for everyone.</span>
      <select name="timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace('_', ' ')}
          </option>
        ))}
      </select>
    </label>
  )
}
