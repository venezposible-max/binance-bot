---
name: creador_de_habilidades
description: Un asistente experto para crear nuevas habilidades (skills) en el entorno de Antigravity.
---
# Creador de Habilidades

Esta habilidad te guía en el proceso de creación de nuevas habilidades para Antigravity. Las habilidades son carpetas con instrucciones y recursos que extienden las capacidades del agente.

## Estructura de una Habilidad

Cada habilidad debe residir en una carpeta propia dentro de `.agent/skills/` y contener al menos un archivo `SKILL.md`.

Directorio: `.agent/skills/<nombre_habilidad>/`
Archivo Principal: `SKILL.md`

### Formato de SKILL.md

El archivo `SKILL.md` debe comenzar con un encabezado YAML (frontmatter) y seguir con instrucciones en Markdown.

```markdown
---
name: nombre_de_la_habilidad
description: Breve descripción de lo que hace la habilidad.
---
# Título de la Habilidad

Instrucciones detalladas sobre cómo debe comportarse el agente cuando utiliza esta habilidad.
Puedes incluir:
- Pasos a seguir
- Reglas específicas
- Ejemplos de uso
```

## Pasos para Crear una Habilidad

1.  **Solicitar Información**:
    *   Pregunta al usuario el nombre de la habilidad (debe ser corto y sin espacios preferiblemente, o usando guiones bajos).
    *   Pregunta la descripción corta.
    *   Pregunta el propósito y las instrucciones detalladas.

2.  **Crear Directorio**:
    *   Utiliza `run_command` para crear el directorio `.agent/skills/<nombre_habilidad>`.

3.  **Crear SKILL.md**:
    *   Redacta el contenido del archivo `SKILL.md` con la información proporcionada.
    *   Usa `write_to_file` para guardar el archivo en `.agent/skills/<nombre_habilidad>/SKILL.md`.

4.  **Confirmación**:
    *   Notifica al usuario que la habilidad ha sido creada y está lista para usarse.

## Consejos

*   Asegúrate de que las instrucciones sean claras y precisas.
*   Si la habilidad requiere scripts adicionales, créalos en una subcarpeta `scripts/` dentro del directorio de la habilidad.
