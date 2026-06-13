import type {
  CreateMessageRequest,
  CreateMessageResult,
  CreateMessageResultWithTools,
  ElicitRequestFormParams,
  ElicitRequestURLParams,
  ElicitResult,
  ProgressNotificationParams,
  Root
} from '@modelcontextprotocol/sdk/types.js'

export type ProgressReporter = {
  report(
    update: Omit<ProgressNotificationParams, 'progressToken'>
  ): Promise<void>
}

export type ClientRoots = {
  supported: boolean
  listChanged: boolean
  list(): Promise<readonly Root[] | undefined>
}

export type ClientSampling = {
  supported: boolean
  createMessage(
    params: CreateMessageRequest['params']
  ): Promise<CreateMessageResult | CreateMessageResultWithTools>
}

export type ClientElicitation = {
  supported: boolean
  form: boolean
  url: boolean
  create(
    params: ElicitRequestFormParams | ElicitRequestURLParams
  ): Promise<ElicitResult>
  complete(elicitationId: string): Promise<void>
}
