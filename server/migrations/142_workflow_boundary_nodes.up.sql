CREATE UNIQUE INDEX multica_workflow_node_boundary_kind_unique
ON multica_workflow_node (workflow_id, (format_schema ->> 'type'))
WHERE format_schema ->> 'type' IN ('start', 'end');
