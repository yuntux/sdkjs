use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use axum::body::Bytes;
use dashmap::DashMap;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tokio::sync::broadcast;
use jsonwebtoken::{decode, DecodingKey, Validation, Algorithm};

#[derive(Deserialize)]
struct Claims {
    // Les claims standard Seafile (ex: doc_id, permission)
    sub: String,
    exp: usize,
}

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

/// État partagé du serveur
struct AppState {
    rooms: DashMap<String, broadcast::Sender<Vec<u8>>>,
    // BlobStore temporaire : Hash SHA256 -> Binaire de l'image
    blob_store: DashMap<String, Vec<u8>>,
}

#[tokio::main]
async fn main() {
    println!("🚀 Démarrage du Relais Rust Loro-ONLYOFFICE (Phase 4)...");

    let state = Arc::new(AppState {
        rooms: DashMap::new(),
        blob_store: DashMap::new(),
    });

    let app = Router::new()
        .route("/room/:doc_id", get(ws_handler))
        .route("/blob", post(upload_blob_handler))
        .with_state(state);

    let addr = "0.0.0.0:3000";
    println!("📡 En écoute sur ws://{}", addr);

    axum::Server::bind(&addr.parse().unwrap())
        .serve(app.into_make_service())
        .await
        .unwrap();
}

/// Handler POST pour le Blob Store (Phase 4)
/// Intercepte l'upload d'une image, la stocke en mémoire et renvoie son Hash.
async fn upload_blob_handler(
    State(state): State<Arc<AppState>>,
    body: Bytes,
) -> impl IntoResponse {
    let mut hasher = Sha256::new();
    hasher.update(&body);
    let hash = format!("{:x}", hasher.finalize());

    // Stockage de l'image (Temporaire, avant commit vers Seafile)
    state.blob_store.insert(hash.clone(), body.to_vec());
    println!("🖼️ Blob reçu et stocké. Hash: {}", hash);

    hash // On retourne le hash au client pour l'insérer dans le CRDT
}

/// Gère la demande de connexion WebSocket entrante avec Authentification Aveugle (Phase 4)
async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(doc_id): Path<String>,
    Query(query): Query<WsQuery>,
    State(state): State<Arc<AppState>>,
) -> Response {
    // Validation JWT (Authentification Aveugle)
    let secret = "SECRET_SEAFILE_SHARED_KEY".as_bytes(); // En prod, issu des variables d'environnement
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    
    match decode::<Claims>(&query.token, &DecodingKey::from_secret(secret), &validation) {
        Ok(_token_data) => {
            println!("🔓 Authentification JWT réussie pour {}", doc_id);
            ws.on_upgrade(move |socket| handle_socket(socket, doc_id, state))
        },
        Err(e) => {
            println!("🔒 Rejet JWT: {}", e);
            (axum::http::StatusCode::UNAUTHORIZED, "Invalid Token").into_response()
        }
    }
}

/// Boucle principale de gestion des messages
async fn handle_socket(mut socket: WebSocket, doc_id: String, state: Arc<AppState>) {
    let tx = state.rooms.entry(doc_id.clone()).or_insert_with(|| {
        let (tx, _rx) = broadcast::channel(100);
        tx
    }).clone();
    
    let mut rx = tx.subscribe();
    println!("👤 Nouveau client connecté sur le document : {}", doc_id);

    loop {
        tokio::select! {
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Binary(bin))) => {
                        let _ = tx.send(bin);
                    }
                    Some(Err(_)) | None => break,
                    _ => {}
                }
            }
            msg = rx.recv() => {
                if let Ok(bin) = msg {
                    if socket.send(Message::Binary(bin)).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
}
