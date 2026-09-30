export type TemporalType = 'Instant' | 'PlainDateTime' | 'PlainDate' | 'PlainTime';
export type TemporalAdapters = Readonly<Partial<Record<TemporalType, { from(value: string): unknown }>>>;
/** Native-to-wire conversion shared by the public and admin APIs. */
export type ScalarTransport = {
    readonly temporal?: TemporalAdapters;
};
export type PublicApiOptions = ScalarTransport;
