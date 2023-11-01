import { DateTime } from 'luxon';
import Pqueue from 'p-queue';
import { getEvents, updateEvent } from '@services/calendar/events';
import { getTrackedTime, trackTime } from '@services/clickup/time.tracking';

import { TrackingTime } from '@services/clickup/types';
import { wait } from 'src/utils/timeout';


export async function timeTracker(calendarId: string, start: Date, end: Date)  {
  const queue = new Pqueue({ concurrency: 10, interval: 2000 });

  const eventsList = await getEvents(calendarId, {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  });

  const queueEvents = eventsList
    .filter(
      (it) =>
        it.status === 'confirmed' &&
                (it?.summary || '').match(/\[.*\]/g) &&
                ((it?.attendees || []).some((at) => at?.self && at.responseStatus === 'accepted') ||
                    it.creator.self),
    )
    .map((event) => {
      return async () => {
        const taskSumaryMatch = ((event?.summary || '').match(/\[.*\]/g) || []) as string[];
        const taskId = taskSumaryMatch.length
          ? taskSumaryMatch[0].replace(/\[|\]/g, '')
          : '';

        const hasCustomTaskId = taskId.includes('-');
        let trackTimes: TrackingTime[] = [];

        const { data, headers, status } = await getTrackedTime({
          taskId,
          hasCustomTaskId,
        });

        trackTimes = data;

        const rateLimitRemaing = Number(headers['x-ratelimit-remaining'] || 0);
        const rateLimitReset = 60 * 1000 + 1500;

        if (status === 429 || rateLimitRemaing < 10) {
          console.log(
            `Pausing queue requests for rate limit: please wait ${
              rateLimitReset / 1000
            } seconds`,
          );
          queue.pause();
          await wait(rateLimitReset);
          queue.start();
          const tracked = await getTrackedTime({
            taskId,
            hasCustomTaskId,
          });

          trackTimes = tracked.data;
        }
        const userId = localStorage.getItem('clickup-user-id')
        const userTrackedTimes = trackTimes.find(
          (it) => Number(it.user.id) === Number(userId),
        );

        const alreadyTracked = userTrackedTimes?.intervals.some((it) => {
          const startDate = DateTime.fromMillis(Number(it.start))
            .setZone('utc')
            .minus({ minutes: 3 })
            .toJSDate();
          const endDate = DateTime.fromMillis(Number(it.end))
            .setZone('utc')
            .plus({ minutes: 3 })
            .toJSDate();

          return startDate <= event.start.dateTime && endDate >= event.end.dateTime;
        });

        // console.log(alreadyTracked)

        if (!alreadyTracked) {
          await trackTime({
            hasCustomTaskId,
            taskId,
            start: event.start.dateTime,
            end: event.end.dateTime,
          });

          console.log(
            `Tracking time for ${
              event.summary
            } - ${event.start.dateTime.toISOString()}`,
          );

          // console.log(event.start.dateTime.toISOString(), `Tracking time for ${event.summary}`)

          // edit color event on google calendar
          await updateEvent(calendarId, {
            ...event,
            colorId: '2',
          });
        } else {
          console.log(
            `Already tracked time for ${
              event.summary
            } - ${event.start.dateTime.toISOString()}`,
          );
          // console.log(event.start.dateTime.toISOString(), `Already tracked time for ${event.summary}`)
        }
      };
    });

  await queue.addAll(queueEvents);

  // await Promise.all(queue.map(it => it()))
}

/*TODO: 
    integrar com banco de dados
        salvar id da task do clickup
        salvar eventos no banco de dados e relacionar com a task do clickup
        salvar time tracked no banco de dados e relacionar com a task do clickup
    
    quando o evento tiver alguma alteração no google calendar, irá impactar na task do clickup

*/
