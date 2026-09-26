export type IntakeData = {
  city: string;
  site_code: string;
  job_code: string;
  primary_shift: string;
  backup_shift: string | null;
  pay_expectation_cents: number | null;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  preferred_language: "en" | "ar" | "es";
  whatsapp_consent: boolean;
};

export const emptyIntake: IntakeData = {
  city: "",
  site_code: "",
  job_code: "",
  primary_shift: "",
  backup_shift: null,
  pay_expectation_cents: null,
  first_name: "",
  last_name: "",
  phone: "",
  email: "",
  preferred_language: "en",
  whatsapp_consent: false,
};

export type StepProps = {
  data: IntakeData;
  update: (patch: Partial<IntakeData>) => void;
};
