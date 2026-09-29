export type TemporalType = 'Instant' | 'PlainDateTime' | 'PlainDate' | 'PlainTime';
export type PublicApiOptions = {
    readonly temporal?: Readonly<Partial<Record<TemporalType, { from(value: string): unknown }>>>;
};
