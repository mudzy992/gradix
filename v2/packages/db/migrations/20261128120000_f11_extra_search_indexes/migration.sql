-- Trigram indexes for the additional entities in global search. RLS and grants are unchanged.
CREATE INDEX project_tasks_search_title_trgm_idx ON public.project_tasks USING gin (title gin_trgm_ops);
CREATE INDEX obligation_types_search_label_trgm_idx ON public.obligation_types USING gin (label gin_trgm_ops);
CREATE INDEX service_orders_search_description_trgm_idx ON public.service_orders USING gin (description gin_trgm_ops);
CREATE INDEX hse_incidents_search_kind_trgm_idx ON public.hse_incidents USING gin (kind gin_trgm_ops);

INSERT INTO public.schema_migrations(name) VALUES ('20261128120000_f11_extra_search_indexes') ON CONFLICT DO NOTHING;
