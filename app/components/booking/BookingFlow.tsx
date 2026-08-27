"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { MAX_PHOTO_COUNT } from "@/app/lib/booking/validation";

const services = [
  { label: "Junk Removal", icon: "JR" },
  { label: "Light Demolition", icon: "LD" },
  { label: "Storage / Relocation", icon: "SR" },
];

const appointmentTypes = [
  {
    label: "On-Site Estimate",
    text: "Have our team take a look at the project and provide an estimate.",
  },
  {
    label: "Service Appointment Request",
    text: "Request a time for our team to perform the work.",
  },
];

type PhotoRef = {
  id: string;
  name: string;
  url: string;
  size: number;
  contentType: string;
  previewUrl?: string;
};

type Slot = {
  start: string;
  end: string;
  label: string;
  dateLabel: string;
};

type FormState = {
  services: string[];
  appointmentType: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  accessNotes: string;
  projectDescription: string;
  photos: PhotoRef[];
  name: string;
  email: string;
  phone: string;
  requestedSlot: Slot | null;
  honeypot: string;
  startedAt: number;
  idempotencyKey: string;
};

const initialState: FormState = {
  services: [],
  appointmentType: "",
  street: "",
  city: "",
  state: "CA",
  zip: "",
  accessNotes: "",
  projectDescription: "",
  photos: [],
  name: "",
  email: "",
  phone: "",
  requestedSlot: null,
  honeypot: "",
  startedAt: Date.now(),
  idempotencyKey: crypto.randomUUID(),
};

export function BookingFlow() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialState);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ leadId: string; requestedTime: string } | null>(
    null,
  );
  const totalSteps = 8;
  const progress = Math.round(((step + 1) / totalSteps) * 100);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }

  function toggleService(service: string) {
    const selected = form.services.includes(service)
      ? form.services.filter((item) => item !== service)
      : [...form.services, service];
    update("services", selected);
  }

  async function continueStep() {
    const validationErrors = validateStep(step, form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    if (step === 5 && slots.length === 0) await loadAvailability();
    setStep((current) => Math.min(current + 1, totalSteps - 1));
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    setErrors({});
    const payload = new FormData();
    const selectedFiles = Array.from(files);
    const previews = selectedFiles.map((file) => URL.createObjectURL(file));
    selectedFiles.forEach((file) => payload.append("photos", file));
    try {
      const response = await fetch("/api/booking/photos", {
        method: "POST",
        body: payload,
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Photo upload failed.");
      const photosWithPreviews = json.photos.map((photo: PhotoRef, index: number) => ({
        ...photo,
        previewUrl: previews[index],
      }));
      update("photos", [...form.photos, ...photosWithPreviews].slice(0, MAX_PHOTO_COUNT));
    } catch (error) {
      previews.forEach((preview) => URL.revokeObjectURL(preview));
      setErrors({
        photos: error instanceof Error ? error.message : "Photo upload failed.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function loadAvailability() {
    setLoading(true);
    setErrors({});
    try {
      const response = await fetch("/api/booking/availability");
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Availability is unavailable.");
      setSlots(json.slots);
      setForm((current) => ({
        ...current,
        requestedSlot:
          current.requestedSlot &&
          json.slots.some((slot: Slot) => slot.start === current.requestedSlot?.start)
            ? current.requestedSlot
            : null,
      }));
      setSelectedDate((current) =>
        json.slots.some((slot: Slot) => slot.dateLabel === current) ? current : "",
      );
    } catch (error) {
      setErrors({
        requestedSlot:
          error instanceof Error ? error.message : "Availability is unavailable.",
      });
    } finally {
      setLoading(false);
    }
  }

  async function submitRequest() {
    const validationErrors = validateStep(step, form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      const response = await fetch("/api/booking/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          services: form.services,
          appointmentType: form.appointmentType,
          address: {
            street: form.street,
            city: form.city,
            state: form.state,
            zip: form.zip,
            accessNotes: form.accessNotes,
          },
          projectDescription: form.projectDescription,
          photos: form.photos,
          customer: {
            name: form.name,
            email: form.email,
            phone: form.phone,
          },
          requestedSlot: form.requestedSlot,
          honeypot: form.honeypot,
          startedAt: form.startedAt,
          idempotencyKey: form.idempotencyKey,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message || "Submission failed.");
      setSuccess({ leadId: json.leadId, requestedTime: json.requestedTime });
    } catch (error) {
      setErrors({
        submit:
          error instanceof Error
            ? error.message
            : "We could not submit your request right now.",
      });
    } finally {
      setLoading(false);
    }
  }

  const groupedSlots = useMemo(() => {
    return slots.reduce<Record<string, Slot[]>>((groups, slot) => {
      groups[slot.dateLabel] = [...(groups[slot.dateLabel] ?? []), slot];
      return groups;
    }, {});
  }, [slots]);
  const selectedDateSlots = selectedDate ? groupedSlots[selectedDate] ?? [] : [];

  if (success) {
    return (
      <section className="booking-shell section">
        <div className="booking-success">
          <p className="eyebrow">Request received</p>
          <h2>Thanks, {firstName(form.name)}.</h2>
          <p className="booking-reference">Request #{success.leadId}</p>
          <p>Requested time: {success.requestedTime}</p>
          <p>
            This appointment is pending confirmation. Our team will review the
            details and contact you to confirm the requested time.
          </p>
          <div className="actions">
            <Link className="button button--primary" href="/">
              Return Home
            </Link>
            <a className="button button--dark" href="tel:+19494245605">
              Call Wade Home Services
            </a>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="booking-shell section" aria-live="polite">
      <div className="booking-card">
        <div className="booking-progress">
          <span>
            Step {step + 1} of {totalSteps}
          </span>
          <div className="booking-progress__track">
            <div style={{ width: `${progress}%` }} />
          </div>
        </div>

        {step === 0 ? (
          <StepBlock title="What can we help you with?" subtitle="Select all that apply.">
            <div className="choice-grid">
              {services.map((service) => (
                <button
                  className={`choice-card${
                    form.services.includes(service.label) ? " choice-card--selected" : ""
                  }`}
                  key={service.label}
                  type="button"
                  onClick={() => toggleService(service.label)}
                  aria-pressed={form.services.includes(service.label)}
                >
                  <span>{service.icon}</span>
                  <strong>{service.label}</strong>
                </button>
              ))}
            </div>
            <FieldError message={errors.services} />
          </StepBlock>
        ) : null}

        {step === 1 ? (
          <StepBlock
            title="What would you like to schedule?"
            subtitle="You'll select your preferred available time. Our team will review the request and confirm it with you."
          >
            <div className="choice-grid choice-grid--two">
              {appointmentTypes.map((option) => (
                <button
                  className={`choice-card${
                    form.appointmentType === option.label ? " choice-card--selected" : ""
                  }`}
                  key={option.label}
                  type="button"
                  onClick={() => update("appointmentType", option.label)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.text}</small>
                </button>
              ))}
            </div>
            <FieldError message={errors.appointmentType} />
          </StepBlock>
        ) : null}

        {step === 2 ? (
          <StepBlock title="Where is the project?" subtitle="Enter the full service address.">
            <div className="field-grid">
              <TextField label="Street Address" value={form.street} onChange={(v) => update("street", v)} error={errors.street} />
              <TextField label="City" value={form.city} onChange={(v) => update("city", v)} error={errors.city} />
              <TextField label="State" value={form.state} onChange={(v) => update("state", v.toUpperCase())} error={errors.state} />
              <TextField label="ZIP Code" value={form.zip} onChange={(v) => update("zip", v)} error={errors.zip} />
              <label className="field field--wide">
                <span>Unit / Gate / Access Notes</span>
                <textarea
                  value={form.accessNotes}
                  onChange={(event) => update("accessNotes", event.target.value)}
                />
              </label>
            </div>
          </StepBlock>
        ) : null}

        {step === 3 ? (
          <StepBlock title="Tell us a little about the project.">
            <label className="field">
              <span>Project Description</span>
              <textarea
                value={form.projectDescription}
                maxLength={1400}
                onChange={(event) => update("projectDescription", event.target.value)}
              />
            </label>
            <FieldError message={errors.projectDescription} />
          </StepBlock>
        ) : null}

        {step === 4 ? (
          <StepBlock
            title="Add project photos."
            subtitle="Photos are optional for now, but they help us understand the scope and prepare a more accurate estimate."
          >
            <label className="photo-drop">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                multiple
                onChange={(event) => uploadPhotos(event.target.files)}
              />
              <span>{loading ? "Uploading..." : "Choose or drag photos"}</span>
              <small>Optional, maximum {MAX_PHOTO_COUNT} photos.</small>
            </label>
            <div className="photo-preview-grid">
              {form.photos.map((photo) => (
                <div className="photo-preview" key={photo.id}>
                  {photo.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo.previewUrl} alt="" />
                  ) : null}
                  <span>{photo.name}</span>
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        "photos",
                        form.photos.filter((item) => item.id !== photo.id),
                      )
                    }
                    aria-label={`Remove ${photo.name}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <FieldError message={errors.photos} />
          </StepBlock>
        ) : null}

        {step === 5 ? (
          <StepBlock title="How can we reach you?">
            <div className="field-grid">
              <TextField label="Name" value={form.name} onChange={(v) => update("name", v)} error={errors.name} />
              <TextField label="Email" value={form.email} onChange={(v) => update("email", v)} error={errors.email} />
              <TextField label="Phone Number" value={form.phone} onChange={(v) => update("phone", v)} error={errors.phone} />
            </div>
            <label className="hidden-field" aria-hidden="true">
              Company
              <input
                tabIndex={-1}
                autoComplete="off"
                value={form.honeypot}
                onChange={(event) => update("honeypot", event.target.value)}
              />
            </label>
          </StepBlock>
        ) : null}

        {step === 6 ? (
          <StepBlock
            title="Choose a preferred request time."
            subtitle="This does not confirm the appointment. Wade Home Services will review and confirm with you."
          >
            <button className="button button--ghost" type="button" onClick={loadAvailability}>
              Refresh Available Times
            </button>
            <FieldError message={errors.requestedSlot} />
            <div className="field-grid availability-selectors">
              <label className="field">
                <span>Preferred Date</span>
                <select
                  value={selectedDate}
                  onChange={(event) => {
                    const nextDate = event.target.value;
                    setSelectedDate(nextDate);
                    update("requestedSlot", null);
                  }}
                >
                  <option value="">Select a date</option>
                  {Object.keys(groupedSlots).map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Preferred Time</span>
                <select
                  disabled={!selectedDate}
                  value={form.requestedSlot?.start ?? ""}
                  onChange={(event) => {
                    const slot = selectedDateSlots.find(
                      (item) => item.start === event.target.value,
                    );
                    update("requestedSlot", slot ?? null);
                  }}
                >
                  <option value="">Select a time</option>
                  {selectedDateSlots.map((slot) => (
                    <option key={slot.start} value={slot.start}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </StepBlock>
        ) : null}

        {step === 7 ? (
          <StepBlock title="Review your request.">
            <div className="review-summary">
              <Summary label="Services" value={form.services.join(", ")} />
              <Summary label="Appointment Type" value={form.appointmentType} />
              <Summary label="Address" value={`${form.street}, ${form.city}, ${form.state} ${form.zip}`} />
              <Summary label="Contact" value={`${form.name} / ${form.email} / ${form.phone}`} />
              <Summary label="Photos" value={`${form.photos.length} uploaded`} />
              <Summary label="Requested Time" value={form.requestedSlot?.label ?? ""} />
            </div>
            <FieldError message={errors.submit} />
          </StepBlock>
        ) : null}

        <div className="booking-actions">
          <button
            className="button button--ghost"
            type="button"
            disabled={step === 0 || loading}
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
          >
            Back
          </button>
          {step < totalSteps - 1 ? (
            <button
              className="button button--primary"
              type="button"
              disabled={loading}
              onClick={continueStep}
            >
              Continue
            </button>
          ) : (
            <button
              className="button button--primary"
              type="button"
              disabled={loading}
              onClick={submitRequest}
            >
              {loading ? "Submitting..." : "Submit Request"}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function StepBlock({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="booking-step">
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
      {children}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
      <FieldError message={error} />
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="field-error" role="alert">
      {message}
    </p>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function validateStep(step: number, form: FormState) {
  const errors: Record<string, string> = {};
  if (step === 0 && form.services.length === 0) {
    errors.services = "Select at least one service.";
  }
  if (step === 1 && !form.appointmentType) {
    errors.appointmentType = "Choose what you would like to schedule.";
  }
  if (step === 2) {
    if (!form.street.trim()) errors.street = "Street address is required.";
    if (!form.city.trim()) errors.city = "City is required.";
    if (!form.state.trim()) errors.state = "State is required.";
    if (!/^\d{5}(?:-\d{4})?$/.test(form.zip.trim())) {
      errors.zip = "Enter a valid ZIP code.";
    }
  }
  if (step === 3 && form.projectDescription.trim().length < 8) {
    errors.projectDescription = "Tell us a little about the project.";
  }
  if (step === 5) {
    if (!form.name.trim()) errors.name = "Name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (form.phone.replace(/\D/g, "").length < 10) {
      errors.phone = "Enter a valid phone number.";
    }
  }
  if (step === 6 && !form.requestedSlot) {
    errors.requestedSlot = "Select a requested time.";
  }
  if (step === 7 && !form.requestedSlot) {
    errors.submit = "Select a requested time before submitting.";
  }
  return errors;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || "there";
}
