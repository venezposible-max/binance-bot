# 🤖 Sentinel Binance Bot

Sistema de trading automatizado de alta frecuencia diseñado para operar en Binance Futures/Spot. Incorpora análisis técnico avanzado, gestión de riesgo en tiempo real y arquitectura de doble motor (Live/Simulation).

## 🚀 Características Principales

*   **Doble Motor (Dual Engine):** Opera simultáneamente en modo **LIVE** (Dinero Real) y **SIMULATION** (Paper Trading) con configuraciones y saldos totalmente independientes.
*   **Estrategia BLITZ:** Scalping de alta velocidad basado en Order Blocks, Flujo de Órdenes y Rebotes de EMA.
*   **Gestión de Riesgo:** Control de Drawdown, Stop Loss dinámico y Take Profit basado en ATR.
*   **Interfaz React:** Panel de control en tiempo real con actualización optimista (sin recargas).

## 🛡️ Hybrid Protect (Filtro Genético)

El **Hybrid Protect** es la capa de defensa estadística del bot. Utiliza un algoritmo de probabilidad basado en patrones históricos para validar cada señal de entrada antes de ejecutarla.

### ¿Cómo funciona?
Cada vez que la estrategia técnica (BLITZ) detecta una oportunidad de compra, el Filtro Genético analiza la estructura de mercado actual y la compara con miles de escenarios pasados para calcular las **Odds (Probabilidades de Éxito)**.

*   **Cálculo de Odds:** Se basa en la fuerza de la tendencia, volumen relativo y distancia a medias móviles claves.
*   **Filtrado:** Si la probabilidad calculada es **MENOR** que el umbral configurado por el usuario, la operación se descarta automáticamente, incluso si los indicadores técnicos dan señal de compra.

### Configuración
Puedes ajustar la agresividad del filtro directamente desde el panel de control:

1.  Ve a la tarjeta de **Wallet** y pulsa el botón de configuración (⚙️).
2.  Busca la opción **"Filtro Genético (% Probabilidad Mínima)"**.
3.  Ingresa el valor deseado (Ejemplo: `67` para un filtro conservador, `40` para uno más agresivo).

**Impacto:**
*   ⬆️ **Mayor % (e.g. 70%):** Menos operaciones, pero mayor tasa de acierto (Filtrado estricto).
*   ⬇️ **Menor % (e.g. 40%):** Más operaciones, pero mayor riesgo de falsos positivos.

## ⚙️ Instalación y Despliegue

El proyecto está configurado para desplegarse automáticamente en railway/vercel mediante los push a la rama `main`.

### Variables de Entorno Requeridas
*   `BINANCE_API_KEY`: Tu API Key de Binance.
*   `BINANCE_API_SECRET`: Tu API Secret.
*   `CRON_SECRET`: Clave de seguridad para la ejecución de tareas programadas.
*   `REDIS_URL`: URL de conexión a la base de datos Redis (Persistencia).

---
*Developed by Antigravity Agents*
