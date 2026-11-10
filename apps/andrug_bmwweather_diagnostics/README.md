# BMW Weather Diagnostics — RHMI app

Отдельное графическое приложение для BMW MGU ID7. Показывает состояние:
- BMW Weather Bridge;
- MGU Store Uplink и DNS;
- HTTPS-запроса к MET Norway;
- нативного Weather cache и прав записи;
- диагностического отчёта самого Bridge.

Кнопка «Проверить» создаёт запрос в общем OAP data-каталоге. Фоновый сервис
обрабатывает его и обновляет `bmwweather-diagnostics.json`. Интерфейс не
изменяет кэш погоды и не перезапускает Weather Bridge.

Сборка выполняется MGU App Kit из `aurelmarius/bmw-games`. Итоговые файлы:
`andrug_bmwweather_diagnostics@0.1.0.mgu` и `.tgz`.
