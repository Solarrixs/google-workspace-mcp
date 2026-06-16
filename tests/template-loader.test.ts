import { describe, it, expect, vi } from 'vitest';
import { filterTemplates } from '../src/templates/matcher.js';
import { serializeTemplates } from '../src/templates/serializer.js';
import type { ReplyTemplate } from '../src/templates/loader.js';

const sampleTemplates: ReplyTemplate[] = [
  {
    id: 'interview',
    name: 'Interview Scheduling',
    description: 'Schedule interviews',
    match_labels: ['AI/Respond'],
    match_subject_keywords: ['interview', 'schedule'],
    variants: [
      { name: 'propose', tone: 'friendly', body: 'Hi {candidate_name}, pick a time: {calendar_link}' },
    ],
  },
  {
    id: 'followup',
    name: 'Follow-up',
    description: 'Follow up with candidates',
    match_labels: [],
    match_subject_keywords: ['follow up', 'checking in'],
    variants: [
      { name: 'gentle', tone: 'casual', body: 'Just bumping this! {my_first_name}' },
    ],
  },
  {
    id: 'ack',
    name: 'Acknowledgment',
    description: 'Confirm receipt',
    match_labels: ['AI/Respond'],
    match_subject_keywords: ['application', 'resume'],
    variants: [
      { name: 'received', tone: 'warm', body: 'Got it, thanks! {my_first_name}' },
    ],
  },
];

describe('template matcher', () => {
  it('matches by label', () => {
    const result = filterTemplates(sampleTemplates, { labels: ['AI/Respond'], subject: 'hello' }, 8);
    // interview and ack both match AI/Respond
    expect(result.length).toBe(2);
    expect(result.map(t => t.id)).toContain('interview');
    expect(result.map(t => t.id)).toContain('ack');
  });

  it('matches by subject keyword', () => {
    const result = filterTemplates(sampleTemplates, { labels: [], subject: 'Re: interview scheduling' }, 8);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('interview');
  });

  it('returns all when no matches', () => {
    const result = filterTemplates(sampleTemplates, { labels: [], subject: 'random topic' }, 8);
    expect(result.length).toBe(3);
  });

  it('respects max cap', () => {
    const result = filterTemplates(sampleTemplates, { labels: [], subject: 'random' }, 2);
    expect(result.length).toBe(2);
  });

  it('ranks label match higher than subject match', () => {
    const result = filterTemplates(sampleTemplates, { labels: ['AI/Respond'], subject: 'interview' }, 8);
    // interview has both label(2) + subject(1) = 3, ack has label(2) = 2
    expect(result[0].id).toBe('interview');
  });
});

describe('template serializer', () => {
  it('serializes templates with variable substitution', () => {
    const result = serializeTemplates(
      [sampleTemplates[0]],
      { calendar_link: 'https://cal.com/maxx', my_first_name: 'Maxx' }
    );
    expect(result).toContain('Interview Scheduling');
    expect(result).toContain('https://cal.com/maxx');
    expect(result).not.toContain('{calendar_link}');
  });

  it('returns empty string for no templates', () => {
    expect(serializeTemplates([], {})).toBe('');
  });

  it('keeps unset variables as placeholders', () => {
    const result = serializeTemplates([sampleTemplates[0]], { my_first_name: '' });
    expect(result).toContain('{calendar_link}');
    expect(result).toContain('{candidate_name}');
  });
});
