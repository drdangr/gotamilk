# GotaMilk - Умный список покупок

## 📋 Описание проекта

**GotaMilk** - это мобильное веб-приложение для совместного составления списков покупок с умной оптимизацией по ценам и магазинам.

### Ключевая идея
Пользователи создают списки покупок, система помогает найти оптимальное распределение покупок по магазинам с учетом цен, расстояния и координации между несколькими покупателями в реальном времени.

### Целевая аудитория
- Семьи (совместные покупки)
- Компании друзей (закупка для пикников, мероприятий)
- Индивидуальные покупатели, желающие экономить

---

## 🎯 Основные функции

### 1. Списки покупок
- Создание неограниченного количества списков
- Добавление товаров с указанием количества
- Отметка купленных товаров
- История списков

### 2. Оптимизация по ценам
- Автоматический анализ цен в разных магазинах
- Рекомендации: где купить дешевле
- Варианты: все в одном магазине vs распределение по нескольким
- Учет расстояния и времени в пути

### 3. Сканирование чеков
- Загрузка фото чеков (поддержка нескольких фото одного чека)
- OCR распознавание через Claude API
- Автоматическое обновление базы цен
- Только данные сохраняются, фото удаляются

### 4. Совместное использование (Realtime)
- Несколько пользователей работают с одним списком одновременно
- Каждый выбирает свой магазин
- Распределение товаров между покупателями
- Live-обновления: кто что купил
- Умные рекомендации по распределению

### 5. Группировка по отделам
- Опциональная группировка товаров по отделам магазина
- Уникальные правила для каждого магазина
- Редактируемые названия отделов
- Ручное перемещение товаров с запоминанием правил
- AI-сортировка (Claude API) с fallback на словарь

### 6. Геолокация
- Автоопределение ближайших магазинов
- Расстояние и время до магазина (Google Maps API)
- Учет расстояния в оптимизации

---

## 🏗️ Архитектура данных

### Основные сущности

#### 1. Списки покупок (shopping_lists)
```sql
CREATE TABLE shopping_lists (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  name text NOT NULL,
  created_at timestamp DEFAULT now()
);
```
**Принцип:** Список НЕ привязан к магазину до момента покупки

#### 2. Товары в списке (list_items)
```sql
CREATE TABLE list_items (
  id uuid PRIMARY KEY,
  list_id uuid REFERENCES shopping_lists(id),
  name text NOT NULL,
  quantity text,
  checked boolean DEFAULT false,
  checked_by uuid REFERENCES auth.users(id),
  checked_at timestamp,
  checked_in_store uuid REFERENCES stores(id),
  created_at timestamp DEFAULT now()
);
```

#### 3. Магазины (stores)
```sql
CREATE TABLE stores (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  address text,
  lat decimal,
  lng decimal,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamp DEFAULT now()
);
```

#### 4. Правила сортировки (sorting_rules)
```sql
CREATE TABLE sorting_rules (
  store_id uuid REFERENCES stores(id),
  item_name_normalized text NOT NULL,
  department text NOT NULL,
  PRIMARY KEY (store_id, item_name_normalized)
);
```
**Принцип:** Уникальны для каждого магазина

#### 5. База цен (item_prices)
```sql
CREATE TABLE item_prices (
  id uuid PRIMARY KEY,
  store_id uuid REFERENCES stores(id),
  item_name_normalized text NOT NULL,
  item_full_name text,
  price decimal NOT NULL,
  quantity text,
  user_id uuid REFERENCES auth.users(id),
  scanned_at timestamp DEFAULT now()
);
```
**Источник:** Сканирование чеков пользователями

#### 6. Намерения покупки (item_intentions)
```sql
CREATE TABLE item_intentions (
  id uuid PRIMARY KEY,
  list_item_id uuid REFERENCES list_items(id),
  user_id uuid REFERENCES auth.users(id),
  store_id uuid REFERENCES stores(id),
  created_at timestamp DEFAULT now(),
  UNIQUE(list_item_id, user_id)
);
```
**Назначение:** Кто какой товар планирует купить и где

#### 7. Сессии покупок (shopping_sessions)
```sql
CREATE TABLE shopping_sessions (
  id uuid PRIMARY KEY,
  list_id uuid REFERENCES shopping_lists(id),
  store_id uuid REFERENCES stores(id),
  user_id uuid REFERENCES auth.users(id),
  started_at timestamp DEFAULT now(),
  completed_at timestamp,
  is_active boolean DEFAULT true
);
```

#### 8. Чеки (receipts)
```sql
CREATE TABLE receipts (
  id uuid PRIMARY KEY,
  store_id uuid REFERENCES stores(id),
  user_id uuid REFERENCES auth.users(id),
  total_amount decimal,
  purchased_at timestamp,
  created_at timestamp DEFAULT now()
);
```
**Важно:** Фото чеков НЕ хранятся в БД

---

## 🎨 UI/UX Флоу

### Основной флоу пользователя

```
1. Вход / Регистрация
   └─> Email/Password или Google OAuth

2. Главный экран: Списки покупок
   ├─> [+ Создать список]
   ├─> Список "На неделю" (15 товаров)
   ├─> Список "Пикник" (8 товаров)
   └─> [⚙️ Настройки]

3. Создание списка
   └─> Название списка → Добавление товаров
   
4. Добавление товаров
   ├─> Название
   ├─> Количество (опционально)
   └─> [Добавить]

5. Оптимизация списка
   [Кнопка "Где купить дешевле?"]
   
   └─> Варианты:
       • Ашан: 450₴ | 📍 300м | ⏱️ 20 мин
       • Новус: 415₴ | 📍 800м | ⏱️ 25 мин (-35₴)
       • Разбить: 395₴ | ⏱️ 40 мин (-55₴)

6. Выбор магазина и покупка
   [Иду в Новус]
   
   └─> Список с товарами
       [☐] Молоко [💰 Новус 45₴]
       [☐] Хлеб   [💰 Ашан 18₴]
       
       [Переключатель: Группировать по отделам]

7. Группировка по отделам (опционально)
   📦 Молочные продукты (3)
      [☐] Молоко
      [☐] Кефир
      [☐] Сыр
   
   🥩 Мясо и птица (2)
      [☐] Курица
      [☐] Колбаса

8. Сканирование чека после покупки
   [📸 Загрузить чек]
   
   └─> Выбрать фото (1-5 шт)
   └─> OCR распознавание
   └─> Проверка и корректировка данных
   └─> Сохранение цен в БД
   └─> Фото удаляются
```

### Совместное использование (Multi-user)

```
📝 Список "На неделю" (30 товаров)
👥 Активны: Ты, Жена, Друг (3)

Товары с чипами:

☐ Молоко 1л        [💰 Новус 45₴]  [👤 Я → Новус]
☐ Хлеб             [💰 Ашан 18₴]   [👤 Жена → Ашан]
☐ Курица 1кг       [💰 Новус 120₴] [👤 Не выбрано]
✅ Помидоры         [💰 Ашан 35₴]   [✓ Жена 2 мин назад]
☐ Сыр 200г         [💰 Фуршет 52₴] [👤 Не выбрано]
                   ⚠️ Никто не идет в Фуршет!

─────────────────────────────────────────────────

💡 Умная оптимизация:

Текущий план:
👨 Ты → Новус: Молоко, Курица (165₴)
👩 Жена → Ашан: Хлеб, Помидоры (53₴)
❌ Сыр - некому купить!

Рекомендации:
1. Жена возьмет Сыр в Ашане за 58₴
   +6₴, но список полный ✓
   
2. Ты заедешь в Фуршет за Сыром
   Экономия 6₴, но +15 мин 🕐

[Применить вариант 1] [Сам выберу]

─────────────────────────────────────────────────

📊 Live прогресс:
👨 Ты: 0/2 куплено
👩 Жена: 1/2 куплено
Всего: 1/5 | Потрачено: 35₴
```

---

## 🛠️ Технический стек

### Frontend
- **React** - UI библиотека
- **Vite** - Build tool
- **Tailwind CSS** - Стилизация
- **Lucide React** - Иконки

### Backend & Database
- **Supabase** - Backend as a Service
  - PostgreSQL база данных
  - Realtime subscriptions
  - Authentication (Email, Google OAuth)
  - Row Level Security (RLS)

### APIs
- **Claude API (Anthropic)** - OCR чеков + AI-сортировка товаров
- **Google Maps Platform**:
  - Places API - поиск магазинов
  - Distance Matrix API - расстояние и время
  - Geocoding API - работа с адресами

### Deployment
- **Vercel** - Hosting и CI/CD
- **GitHub** - Version control

---

## 🔧 Реализация ключевых функций

### 1. Сканирование чеков

#### Процесс:
```javascript
async function scanReceipt(photos, storeId) {
  // 1. Загрузка фото только в память браузера (не в БД!)
  const base64Images = await Promise.all(
    photos.map(photo => convertToBase64(photo))
  );
  
  // 2. OCR через Claude API
  const items = [];
  for (const image of base64Images) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { 
                type: "base64", 
                media_type: "image/jpeg", 
                data: image 
              }
            },
            {
              type: "text",
              content: `Извлеки из чека список товаров. Верни JSON:
              {
                "items": [
                  {"name": "Молоко", "price": 45.50, "quantity": "1л"},
                  ...
                ],
                "total": 450.00,
                "date": "2025-10-08"
              }`
            }
          ]
        }]
      })
    });
    
    const data = await response.json();
    const parsed = JSON.parse(data.content[0].text);
    items.push(...parsed.items);
  }
  
  // 3. Объединение результатов с нескольких фото
  const mergedItems = mergeReceiptItems(items);
  
  // 4. Показать пользователю для корректировки
  showReceiptPreview(mergedItems);
  
  // 5. После подтверждения - сохранить ТОЛЬКО данные
  await savePricesToDB(mergedItems, storeId);
  
  // 6. Фото автоматически удаляются (не сохраняются вообще)
}
```

### 2. Оптимизация покупок

#### Алгоритм:
```javascript
async function optimizeShopping(shoppingList, userStores, userLocation) {
  const options = [];
  
  // Получаем цены для всех товаров во всех магазинах
  const prices = await getPricesForItems(
    shoppingList.items, 
    userStores
  );
  
  // Получаем расстояния до магазинов
  const distances = await getDistancesToStores(
    userLocation, 
    userStores
  );
  
  // Вариант 1: Все в одном магазине
  for (const store of userStores) {
    const total = calculateTotalPrice(shoppingList.items, prices[store.id]);
    const distance = distances[store.id];
    
    options.push({
      type: 'single',
      stores: [store],
      total: total,
      distance: distance.meters,
      time: distance.duration,
      items: shoppingList.items.map(item => ({
        ...item,
        store: store.name,
        price: prices[store.id][item.name]
      }))
    });
  }
  
  // Вариант 2: Распределение по 2 магазинам
  const combinations = getCombinations(userStores, 2);
  for (const combo of combinations) {
    const distribution = optimizeDistribution(
      shoppingList.items,
      combo,
      prices
    );
    
    const totalPrice = distribution.totalPrice;
    const totalTime = calculateTotalTime(combo, distances);
    const savings = options[0].total - totalPrice;
    
    // Учитываем стоимость времени (15₴ за доп. магазин)
    const timeCost = 15;
    
    if (savings > timeCost) {
      options.push({
        type: 'multiple',
        stores: combo,
        total: totalPrice,
        time: totalTime,
        savings: savings,
        distribution: distribution.items
      });
    }
  }
  
  // Сортировка по оптимальности
  return options.sort((a, b) => {
    const scoreA = a.total / a.time; // цена за минуту
    const scoreB = b.total / b.time;
    return scoreA - scoreB;
  });
}
```

### 3. AI-сортировка товаров

#### Приоритет правил:
```javascript
async function categorizeItem(itemName, storeId, sortingRules) {
  const normalized = itemName.toLowerCase().trim();
  
  // 1. Проверяем сохраненные правила магазина (highest priority)
  if (sortingRules[storeId]?.[normalized]) {
    return sortingRules[storeId][normalized];
  }
  
  // 2. Claude API (если ключ есть)
  if (claudeApiKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 100,
          messages: [{
            role: "user",
            content: `Определи отдел супермаркета для товара "${itemName}". 
            Ответь ТОЛЬКО названием отдела (например: "Молочные продукты").`
          }]
        })
      });
      
      const data = await response.json();
      return data.content[0].text.trim();
    } catch (error) {
      console.error('Claude API failed:', error);
      // fallback ниже
    }
  }
  
  // 3. Fallback: Словарь ключевых слов
  const CATEGORIES = {
    'Молочные продукты': ['молоко', 'кефир', 'сыр', 'творог'],
    'Мясо и птица': ['мясо', 'курица', 'колбаса', 'сосиски'],
    'Овощи и фрукты': ['помидор', 'огурец', 'яблоко', 'банан'],
    // ...
  };
  
  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some(kw => normalized.includes(kw))) {
      return category;
    }
  }
  
  return 'Разное';
}
```

### 4. Realtime синхронизация

#### Подписка на изменения:
```javascript
useEffect(() => {
  if (!currentList) return;
  
  // Подписка на изменения товаров
  const itemsChannel = supabase
    .channel(`list-items-${currentList.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'list_items',
      filter: `list_id=eq.${currentList.id}`
    }, (payload) => {
      if (payload.eventType === 'UPDATE' && payload.new.checked) {
        // Показать уведомление
        const userName = getUserName(payload.new.checked_by);
        showNotification(`${userName} купил ${payload.new.name}`);
      }
      
      // Обновить локальное состояние
      loadItems();
    })
    .subscribe();
  
  // Подписка на намерения
  const intentionsChannel = supabase
    .channel(`intentions-${currentList.id}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'item_intentions'
    }, () => {
      loadIntentions();
    })
    .subscribe();
  
  return () => {
    itemsChannel.unsubscribe();
    intentionsChannel.unsubscribe();
  };
}, [currentList]);
```

### 5. Управление намерениями (Multi-user)

```javascript
// Пользователь отметил "Я возьму этот товар"
async function claimItem(itemId, userId, storeId) {
  // Проверяем конфликты
  const existing = await supabase
    .from('item_intentions')
    .select('*, users(name)')
    .eq('list_item_id', itemId)
    .neq('user_id', userId);
  
  if (existing.data.length > 0) {
    // Есть конфликт
    const otherUser = existing.data[0].users.name;
    const confirmed = window.confirm(
      `${otherUser} уже планирует купить этот товар. Всё равно отметить?`
    );
    if (!confirmed) return;
  }
  
  // Сохраняем намерение
  await supabase
    .from('item_intentions')
    .upsert({
      list_item_id: itemId,
      user_id: userId,
      store_id: storeId
    });
  
  // Обновляем рекомендации для всех
  await recalculateOptimization();
}

// Динамический пересчет оптимизации
async function recalculateOptimization() {
  const intentions = await loadAllIntentions();
  const unassigned = items.filter(
    item => !intentions.find(i => i.list_item_id === item.id)
  );
  
  if (unassigned.length > 0) {
    const suggestions = await generateSuggestions(unassigned, intentions);
    showSuggestions(suggestions);
  }
}
```

---

## 📱 UI/UX принципы

### Мобильный First
- Все интерфейсы оптимизированы под мобильные экраны
- Крупные элементы для удобного тапа
- Минимум скроллинга
- Быстрый доступ к основным действиям

### Визуальная иерархия
- **Чипы** для быстрого сканирования информации:
  - 💰 зеленый - лучшая цена
  - 👤 синий - кто берет товар
  - ⚠️ красный - предупреждения
- Крупные чекбоксы для отметки купленного
- Зачеркивание купленных товаров

### Минимум кликов
- Добавление товара: название → Enter
- Отметка купленного: один тап
- Переключение группировки: тумблер

### Realtime feedback
- Мгновенное обновление при действиях других пользователей
- Уведомления о важных событиях
- Прогресс-бар покупок

### Оффлайн-режим (Future)
- Локальное кэширование данных
- Очередь изменений при потере связи
- Синхронизация при восстановлении

---

## 🗓️ Roadmap

### Phase 1: MVP (Completed)
- ✅ Авторизация (Email, Google OAuth)
- ✅ Создание списков покупок
- ✅ Добавление/удаление/редактирование товаров
- ✅ Группировка по отделам
- ✅ Ручное перемещение товаров
- ✅ Сохранение правил сортировки
- ✅ Realtime синхронизация
- ✅ Базовая БД структура

### Phase 2: Оптимизация (In Progress)
- 🔄 Переделка структуры БД (Списки first)
- 🔄 Сканирование чеков + OCR
- 🔄 База цен
- 🔄 Показ ориентировочных цен в списке
- 🔄 Google Maps API интеграция
- 🔄 Алгоритм оптимизации покупок

### Phase 3: Multi-user (Planned)
- 📋 Система намерений (item_intentions)
- 📋 Live координация между покупателями
- 📋 Чипы с информацией кто что берет
- 📋 Умные рекомендации по распределению
- 📋 Обработка конфликтов
- 📋 Live прогресс покупок

### Phase 4: Улучшения (Future)
- 📋 ML для нормализации названий товаров
- 📋 История цен + графики динамики
- 📋 Push-уведомления
- 📋 Учет пробок (Google Traffic API)
- 📋 Шаринг списков по ссылке
- 📋 Категории списков (Пикник, Неделя, и т.д.)
- 📋 Темная тема
- 📋 PWA (установка на главный экран)

### Phase 5: Аналитика (Future)
- 📋 Статистика расходов
- 📋 Самые частые покупки
- 📋 Динамика цен за период
- 📋 Лучшие магазины по категориям
- 📋 Экономия за месяц/год

---

## 🔐 Безопасность и приватность

### Row Level Security (RLS)
Все таблицы защищены RLS политиками:
- Пользователь видит только свои данные
- Shared списки - только участники
- Цены - агрегированные от всех пользователей

### Приватность
- Фото чеков НЕ сохраняются
- Геолокация запрашивается с разрешения
- Email не показывается другим пользователям
- Можно удалить все данные

### API ключи
- Claude API ключ хранится в localStorage (опционально)
- Supabase ключи - в environment variables
- Google Maps API ключ - ограничен по доменам

---

## 💰 Стоимость эксплуатации

### Free tier:
- **Supabase**: до 500MB БД + 2GB storage бесплатно
- **Vercel**: бесплатный хостинг
- **Google Maps**: $200 кредитов/месяц (~40k запросов)

### Платные API:
- **Claude API**: $3 за 1M input tokens (~10,000 чеков)
- **Google Maps** (сверх лимита):
  - Distance Matrix: $5 / 1000 запросов
  - Places API: $17-32 / 1000 запросов

### Оценка для 1000 активных пользователей/месяц:
- Supabase: Free tier достаточно
- Claude API: ~$30/месяц (если все сканируют чеки)
- Google Maps: Free tier достаточно
- **Итого: $0-50/месяц**

---

## 🚀 Deployment

### Локальная разработка:
```bash
npm install
npm run dev
```

### Production deploy:
```bash
git push origin main
# Vercel auto-deploy
```

### Environment Variables:
```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
```

---

## 📚 Полезные ссылки

- **Repo**: https://github.com/drdangr/gotamilk
- **Production**: https://gotamilk.vercel.app
- **Supabase Dashboard**: https://supabase.com/dashboard
- **Vercel Dashboard**: https://vercel.com/dashboard

---

## 👥 Команда

- **Dan** - Product Owner, Developer

---

**Версия документа:** 1.0  
**Последнее обновление:** 2025-10-08