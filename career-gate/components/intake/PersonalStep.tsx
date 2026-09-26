import { Checkbox } from "@/components/ui/Checkbox";
import type { IntakeData, StepProps } from "./types";

export function PersonalStep({ data, update }: StepProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <label className="label" htmlFor="first_name">First name</label>
        <input id="first_name" className="input" autoComplete="given-name" required
          value={data.first_name} onChange={(e) => update({ first_name: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="last_name">Last name</label>
        <input id="last_name" className="input" autoComplete="family-name" required
          value={data.last_name} onChange={(e) => update({ last_name: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="phone">Mobile phone</label>
        <input id="phone" className="input" type="tel" autoComplete="tel" required
          placeholder="(313) 555-0100"
          value={data.phone} onChange={(e) => update({ phone: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="email">Email (optional)</label>
        <input id="email" className="input" type="email" autoComplete="email"
          value={data.email} onChange={(e) => update({ email: e.target.value })} />
      </div>
      <div>
        <label className="label" htmlFor="lang">Preferred language</label>
        <select id="lang" className="input" value={data.preferred_language}
          onChange={(e) => update({ preferred_language: e.target.value as IntakeData["preferred_language"] })}>
          <option value="en">English</option>
          <option value="ar">العربية</option>
          <option value="es">Español</option>
        </select>
      </div>
      <Checkbox
        className="sm:col-span-2"
        checked={data.whatsapp_consent}
        onChange={(e) => update({ whatsapp_consent: e.target.checked })}
        label="Send me updates about my application on WhatsApp at this number."
      />
    </div>
  );
}
