fn new_service(name: &str, site: &str) -> NewServiceRecord {
    NewServiceRecord {
        name: name.into(),
        description: Some("Navigation metadata only".into()),
        tags: vec!["work".into()],
        sites: vec![site.into()],
    }
}

#[test]
fn service_crud_relationship_trash_history_and_format3_round_trip_are_safe() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let mut login = new_item("Example admin", "never-render-this-password");
    login.username = "secret-user@example.test".into();
    login.url = Some("https://admin.example.test/login".into());
    let login = session.add_item(login).unwrap();
    let service = session.add_service(new_service("Example", "https://example.test/docs?source=unsafe#fragment")).unwrap();
    let detail = session.link_service_item(service.id, ServiceRelationship {
        item_kind: ServiceItemKind::Login,
        item_id: login.id,
        source: ServiceRelationshipSource::Manual,
    }).unwrap();
    assert_eq!(detail.sites, vec!["https://example.test/docs"]);
    assert_eq!(detail.counts.login, 1);
    let relationship = detail.relationships[0].clone();
    assert_eq!(
        session.move_service_item(service.id, Uuid::new_v4(), relationship),
        Err(VaultError::InvalidService)
    );
    assert_eq!(session.service_detail(service.id).unwrap().counts.login, 1);
    let renderer_json = serde_json::to_string(&detail).unwrap();
    assert!(!renderer_json.contains("secret-user"));
    assert!(!renderer_json.contains("never-render"));

    session.update_service(ServiceRecordUpdate {
        id: service.id,
        name: "Example Cloud".into(),
        description: None,
        tags: vec!["cloud".into()],
        sites: vec!["https://example.test".into()],
    }).unwrap();
    assert_eq!(session.service_history(service.id).unwrap().len(), 2);

    let encrypted = session.save().unwrap();
    let serialized = String::from_utf8_lossy(&encrypted);
    assert!(!serialized.contains("Example Cloud"));
    assert!(!serialized.contains("never-render-this-password"));
    let mut reopened = VaultSession::unlock("correct horse battery staple", &encrypted).unwrap();
    assert_eq!(reopened.service_detail(service.id).unwrap().counts.login, 1);
    reopened.delete_service(service.id).unwrap();
    let trash = reopened.list_service_trash().unwrap();
    assert_eq!(trash.len(), 1);
    let restored = reopened.restore_service_trash(trash[0].trash_id).unwrap();
    assert_eq!(restored.id, service.id);
    reopened.delete_service(service.id).unwrap();
    let trash_id = reopened.list_service_trash().unwrap()[0].trash_id;
    reopened.purge_service_trash(trash_id).unwrap();
    assert!(reopened.list_services(None).unwrap().is_empty());
}

#[test]
fn service_aggregation_plan_is_deterministic_stale_safe_idempotent_and_reversible() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let mut first = new_item("Example one", "first-password");
    first.url = Some("https://www.example.test/login".into());
    let first = session.add_item(first).unwrap();
    let mut second = new_item("Example two", "second-password");
    second.url = Some("http://example.test/account".into());
    session.add_item(second).unwrap();
    let mut conflict = new_item("Conflicting", "third-password");
    conflict.url = Some("https://alpha.test".into());
    conflict.additional_urls = vec!["https://beta.test".into()];
    session.add_item(conflict).unwrap();
    let mut local = new_item("Local", "fourth-password");
    local.url = Some("http://localhost:3000".into());
    session.add_item(local).unwrap();

    let first_plan = session.service_aggregation_plan().unwrap();
    let repeated = session.service_aggregation_plan().unwrap();
    assert_eq!(first_plan, repeated);
    assert_eq!(first_plan.rule_version, "exact-host-v1");
    assert_eq!(first_plan.clusters.len(), 1);
    assert_eq!(first_plan.high_confidence_item_count, 2);
    assert_eq!(first_plan.conflict_count, 1);
    assert_eq!(first_plan.ungrouped_count, 1);

    let applied = session.apply_service_aggregation_plan(&first_plan.plan_id).unwrap();
    assert_eq!(applied.created_service_count, 1);
    assert_eq!(applied.linked_item_count, 2);
    assert!(!applied.already_applied);
    let again = session.apply_service_aggregation_plan(&first_plan.plan_id).unwrap();
    assert!(again.already_applied);
    assert_eq!(again.batch_id, applied.batch_id);
    assert_eq!(session.list_services(None).unwrap().len(), 1);

    session.rollback_service_aggregation_batch(applied.batch_id).unwrap();
    assert!(session.list_services(None).unwrap().is_empty());

    let stale = session.service_aggregation_plan().unwrap();
    let mut later = new_item("Later", "later-password");
    later.url = Some("https://later.test".into());
    session.add_item(later).unwrap();
    assert_eq!(session.apply_service_aggregation_plan(&stale.plan_id), Err(VaultError::ServiceAggregationPlanExpired));

    let ignored_plan = session.service_aggregation_plan().unwrap();
    let example = ignored_plan.clusters.iter().find(|cluster| cluster.service_key == "host-v1:example.test").unwrap();
    session.ignore_service_suggestion(ServiceIgnoredSuggestion {
        service_key: example.service_key.clone(),
        item_kind: ServiceItemKind::Login,
        item_id: first.id,
    }).unwrap();
    let next = session.service_aggregation_plan().unwrap();
    assert_eq!(next.clusters.iter().find(|cluster| cluster.service_key == "host-v1:example.test").unwrap().relationships.len(), 1);
}

#[test]
fn service_relationships_survive_trash_but_are_removed_on_purge_and_continuous_linking_is_controllable() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    let service = session.add_service(new_service("Example", "https://example.test")).unwrap();
    let mut login = new_item("Example", "private-password");
    login.url = Some("https://example.test/login".into());
    let login = session.add_item(login).unwrap();
    assert_eq!(session.reconcile_service_automatic_links().unwrap(), 1);
    assert_eq!(session.service_detail(service.id).unwrap().counts.login, 1);

    session.delete_item(login.id).unwrap();
    assert_eq!(session.service_detail(service.id).unwrap().counts.login, 0);
    let trash_id = session.list_trash().unwrap()[0].trash_id;
    session.restore_trash(trash_id).unwrap();
    assert_eq!(session.service_detail(service.id).unwrap().counts.login, 1);
    session.delete_item(login.id).unwrap();
    let trash_id = session.list_trash().unwrap()[0].trash_id;
    session.purge_trash(trash_id).unwrap();
    assert!(session.service_detail(service.id).unwrap().relationships.is_empty());

    session.set_service_automatic_linking_enabled(false).unwrap();
    let mut disabled = new_item("Disabled", "private-password");
    disabled.url = Some("https://example.test/disabled".into());
    session.add_item(disabled).unwrap();
    assert_eq!(session.reconcile_service_automatic_links().unwrap(), 0);
    assert!(session.service_detail(service.id).unwrap().relationships.is_empty());
}

#[test]
fn service_aggregation_handles_one_thousand_safe_metadata_records_with_bounded_output() {
    let mut session = VaultSession::create("correct horse battery staple").unwrap();
    for index in 0..1_000 {
        let mut item = new_item(&format!("Account {index}"), "fixture-password");
        item.url = Some(format!("https://service-{}.example.test/account/{index}", index % 100));
        session.add_item(item).unwrap();
    }
    let started = std::time::Instant::now();
    let plan = session.service_aggregation_plan().unwrap();
    assert_eq!(plan.clusters.len(), 100);
    assert_eq!(plan.high_confidence_item_count, 1_000);
    assert_eq!(plan.conflict_count, 0);
    assert_eq!(plan.ungrouped_count, 0);
    assert!(serde_json::to_vec(&plan).unwrap().len() < 300_000);
    assert!(started.elapsed() < std::time::Duration::from_secs(5));
}
