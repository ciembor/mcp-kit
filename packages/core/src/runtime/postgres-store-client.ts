export type PostgresQueryResult<Row> = {
  readonly rows: readonly Row[]
  readonly rowCount: number
}

export type PostgresLikeClient = {
  query<Row extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[]
  ):
    | PostgresQueryResult<Row>
    | Promise<PostgresQueryResult<Row>>
}
