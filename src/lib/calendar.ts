import { getCalendarClient } from './google';
import { DateTime } from 'luxon';
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID!;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Tokyo';
export interface TimeSlot {
  start: string; // ISO
  end: string; // ISO
}
export async function checkFreeBusy(start: string, end: string): Promise<boolean> {
  const calendar = getCalendarClient();
  
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: start,
      timeMax: end,
      items: [{ id: CALENDAR_ID }],
    },
  });
  
  const busy = response.data.calendars?.[CALENDAR_ID]?.busy || [];
  return busy.length === 0;
}
export async function createEvent(
  start: string,
  end: string,
  summary: string
): Promise<string> {
  const calendar = getCalendarClient();
  
  const response = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: {
      summary,
      start: {
        dateTime: start,
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: end,
        timeZone: TIMEZONE,
      },
    },
  });
  
  return response.data.id || '';
}
export async function deleteEvent(eventId: string): Promise<void> {
  if (!eventId?.trim()) return;
  const calendar = getCalendarClient();
  await calendar.events.delete({
    calendarId: CALENDAR_ID,
    eventId: eventId.trim(),
  });
}
export function generateTimeSlots(date: DateTime): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const openHour = parseInt(process.env.OPEN_HOUR || '9', 10);
  const closeHour = parseInt(process.env.CLOSE_HOUR || '22', 10);
  const slotMinutes = parseInt(process.env.SLOT_MINUTES || '30', 10);
  
  let current = date.set({ hour: openHour, minute: 0, second: 0, millisecond: 0 });
  const endOfDay = date.set({ hour: closeHour, minute: 0, second: 0, millisecond: 0 });
  
  while (current < endOfDay) {
    const slotEnd = current.plus({ minutes: slotMinutes });
    slots.push({
      start: current.toISO()!,
      end: slotEnd.toISO()!,
    });
    current = slotEnd;
  }
  
  return slots;
}
export async function getAvailableSlots(date: DateTime): Promise<TimeSlot[]> {
  const allSlots = generateTimeSlots(date);
  const calendar = getCalendarClient();
  
  if (allSlots.length === 0) {
    return [];
  }
  
  const timeMin = allSlots[0].start;
  const timeMax = allSlots[allSlots.length - 1].end;
  
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: CALENDAR_ID }],
    },
  });
  
  const busy = response.data.calendars?.[CALENDAR_ID]?.busy || [];
  const busySet = new Set<string>();
  
  for (const period of busy) {
    if (period.start && period.end) {
      const busyStart = DateTime.fromISO(period.start);
      const busyEnd = DateTime.fromISO(period.end);
      
      for (const slot of allSlots) {
        const slotStart = DateTime.fromISO(slot.start);
        const slotEnd = DateTime.fromISO(slot.end);
        
        // 重複チェック
        if (
          (slotStart < busyEnd && slotEnd > busyStart)
        ) {
          busySet.add(slot.start);
        }
      }
    }
  }
  
  return allSlots.filter(slot => !busySet.has(slot.start));
}
