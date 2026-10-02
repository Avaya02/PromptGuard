import { Queue, type ConnectionOptions } from "bullmq";

import { QUEUE_NAMES } from "@diditbreak/shared-types";

export interface ApiQueues {
  promptRunQueue: Queue;
  judgeRunQueue: Queue;
}

export function createQueues(connection: ConnectionOptions): ApiQueues {
  return {
    promptRunQueue: new Queue(QUEUE_NAMES.promptRun, { connection }),
    judgeRunQueue: new Queue(QUEUE_NAMES.judgeRun, { connection })
  };
}
