import { NextFunction, Request, Response } from 'express';
import { statsService, Timeline, StatsMode } from '../services/stats.service';
import { HttpException } from '@common/exceptions';
import { ErrorCodes } from '@common/enums';

const VALID_TIMELINES: Timeline[] = ['1d', '1w', '1m', '3m', '6m', '1y'];
const VALID_MODES: StatsMode[] = ['owner', 'user'];

class StatsController {
  async getMainStats(req: Request, res: Response, next: NextFunction) {
    try {
      const timeline = req.query.timeline as Timeline;
      const mode = req.query.mode as StatsMode;

      if (!VALID_TIMELINES.includes(timeline)) {
        throw HttpException.BadRequest(ErrorCodes.BadRequest, `timeline must be one of: ${VALID_TIMELINES.join(', ')}`);
      }
      if (!VALID_MODES.includes(mode)) {
        throw HttpException.BadRequest(ErrorCodes.BadRequest, `mode must be one of: ${VALID_MODES.join(', ')}`);
      }

      const result = await statsService.getMainStats(timeline, mode);
      res.set('Cache-Control', 'no-store');
      res.json(result);
    } catch (e) {
      next(e);
    }
  }

  async getTop(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = req.query.mode as StatsMode;
      const timeline = req.query.timeline as Timeline | undefined;

      if (!VALID_MODES.includes(mode)) {
        throw HttpException.BadRequest(ErrorCodes.BadRequest, `mode must be one of: ${VALID_MODES.join(', ')}`);
      }
      if (timeline !== undefined && !VALID_TIMELINES.includes(timeline)) {
        throw HttpException.BadRequest(ErrorCodes.BadRequest, `timeline must be one of: ${VALID_TIMELINES.join(', ')}`);
      }

      const result = await statsService.getTop(mode, timeline);
      res.set('Cache-Control', 'no-store');
      res.json(result);
    } catch (e) {
      next(e);
    }
  }
}

export const statsController = new StatsController();
