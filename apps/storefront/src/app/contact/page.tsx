'use client';

import { useState } from 'react';
import { Mail, Phone, MapPin, Clock, Send } from 'lucide-react';

export default function ContactPage() {
  const [formData, setFormData] = useState({ name: '', email: '', subject: '', message: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!formData.name || formData.name.length < 2) newErrors.name = 'Name is required';
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) newErrors.email = 'Invalid email address';
    if (!formData.subject || formData.subject.length < 3) newErrors.subject = 'Subject is required';
    if (!formData.message || formData.message.length < 20) newErrors.message = 'Message must be at least 20 characters';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setSubmitting(false);
    setSubmitted(true);
    setFormData({ name: '', email: '', subject: '', message: '' });
  };

  const contactInfo = [
    { icon: Mail, label: 'Email', value: 'support@nest-electronics.com' },
    { icon: Phone, label: 'Phone', value: '+20 100 000 0000' },
    { icon: MapPin, label: 'Location', value: 'Cairo, Egypt' },
    { icon: Clock, label: 'Hours', value: 'Sat–Thu, 9am – 6pm' },
  ];

  return (
    <div className="container-nest py-12 grid grid-cols-1 lg:grid-cols-2 gap-12">
      {/* Left Info */}
      <div>
        <h1 className="text-2xl font-heading font-semibold text-foreground mb-2">Get in Touch</h1>
        <p className="text-base text-foreground-muted mb-8">
          Our team of engineers is ready to help you with your project.
        </p>
        <div className="space-y-4">
          {contactInfo.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <item.icon className="text-primary text-lg mt-0.5" strokeWidth={1.5} />
              <div>
                <p className="text-xs text-foreground-muted uppercase tracking-wide">{item.label}</p>
                <p className="text-sm text-foreground font-medium">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right Form */}
      <div className="bg-white border border-border rounded-lg p-6 shadow-card">
        <h2 className="text-lg font-heading font-semibold text-foreground mb-4">Send us a Message</h2>
        {submitted ? (
          <div className="p-4 bg-success-light border border-success/20 rounded-md text-success text-sm">
            Thank you! Your message has been sent successfully. We will get back to you soon.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="input-base"
                placeholder="Your name"
              />
              {errors.name && <p className="text-xs text-danger mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="input-base"
                placeholder="you@example.com"
              />
              {errors.email && <p className="text-xs text-danger mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1">Subject</label>
              <input
                type="text"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                className="input-base"
                placeholder="How can we help?"
              />
              {errors.subject && <p className="text-xs text-danger mt-1">{errors.subject}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground-muted mb-1">Message</label>
              <textarea
                rows={5}
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="input-base resize-none"
                placeholder="Tell us more about your inquiry..."
              />
              {errors.message && <p className="text-xs text-danger mt-1">{errors.message}</p>}
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full py-2.5 text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
