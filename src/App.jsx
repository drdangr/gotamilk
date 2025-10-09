import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabaseClient';
import { Plus, Settings, ChevronDown, ChevronUp, Check, X, Trash2, RotateCcw, ArrowLeft, Move, LogOut } from 'lucide-react';
import { upsertIntention, clearIntention } from './services/intentions';
import { fetchBestPricesForItemNames, upsertItemPriceByCatalogId, fetchPricesForCatalogItem, deletePriceByCatalogId } from './services/prices';
import { fetchCatalog, addCatalogItem, renameCatalogItem, deleteCatalogItem, upsertCatalogNames, fetchAliases, addAlias, deleteAlias, updateCatalogUnit, updateCatalogDisplayName, searchCatalogSuggestions, mapDisplayNamesForItems } from './services/catalog';
import { useListItems } from './hooks/useListItems';
import { enqueueOp, countPending, syncOnce } from './offline/queue';
import { generateJoinCode, fetchMembersForLists, removeMember, reassignOwner, deleteListEverywhere } from './services/lists';

// Supabase клиент вынесен в ./lib/supabaseClient

// Fallback категории
const FALLBACK_CATEGORIES = {
  'Мясо и птица': ['мясо', 'курица', 'говядина', 'свинина', 'колбаса', 'сосиски', 'фарш', 'ветчина', 'бекон'],
  'Молочные продукты': ['молоко', 'кефир', 'йогурт', 'сметана', 'творог', 'сыр', 'масло сливочное', 'ряженка'],
  'Овощи и фрукты': ['помидоры', 'огурцы', 'картофель', 'лук', 'морковь', 'яблоки', 'бананы', 'капуста', 'перец', 'салат'],
  'Хлеб и выпечка': ['хлеб', 'батон', 'булочки', 'лаваш', 'торт', 'печенье'],
  'Бакалея': ['рис', 'гречка', 'макароны', 'мука', 'сахар', 'соль', 'масло растительное', 'крупа'],
  'Напитки': ['вода', 'сок', 'чай', 'кофе', 'газировка', 'пиво', 'вино'],
  'Замороженные продукты': ['пельмени', 'мороженое', 'замороженные овощи', 'рыба замороженная'],
  'Бытовая химия': ['порошок', 'мыло', 'шампунь', 'туалетная бумага', 'моющее средство', 'губки'],
  'Разное': []
};

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('stores');
  const [stores, setStores] = useState([]);
  const [shops, setShops] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogPrices, setCatalogPrices] = useState({}); // {catalogItemId: {storeId: {price, quantity}}}
  const [catalogAliases, setCatalogAliases] = useState({}); // {catalogItemId: [{id, full_name}]}
  // list-first: магазин как сущность не главный экран
  const [currentStore, setCurrentStore] = useState(null);
  const [currentList, setCurrentList] = useState(null);
  const [lists, setLists] = useState([]);
  const [items, setItems] = useState([]);
  const [sortingRules, setSortingRules] = useState({});
  const [newItemName, setNewItemName] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('');
  const [typeaheadOpen, setTypeaheadOpen] = useState(false);
  const [typeaheadItems, setTypeaheadItems] = useState([]);
  const typeaheadTimer = useRef(null);

  // Helpers: нормализация, парсинг количества, подсветка
  const normalizeText = (s) => (s || '').toLowerCase().trim();

  const parseNameAndQuantity = (raw) => {
    const input = (raw || '').trim();
    if (!input) return { baseName: '', qtyText: '', qtyNum: undefined };
    // pattern: name x2
    let m = input.match(/^(.*?)(?:\s*[x×]\s*)(\d+(?:[.,]\d+)?)[\s]*$/i);
    if (m) {
      const num = parseFloat(m[2].replace(',', '.'));
      return { baseName: m[1].trim(), qtyText: String(num), qtyNum: isNaN(num) ? undefined : num };
    }
    // pattern: name 2кг|2 кг|2л|2 л|2шт
    m = input.match(/^(.*?)(\d+(?:[.,]\d+)?)[\s]*(кг|г|л|мл|шт)[\s]*$/i);
    if (m) {
      const num = parseFloat(m[2].replace(',', '.'));
      const unit = m[3];
      return { baseName: m[1].trim(), qtyText: `${m[2]} ${unit}`.trim(), qtyNum: isNaN(num) ? undefined : num, unit };
    }
    // pattern: trailing number
    m = input.match(/^(.*?)(\d+(?:[.,]\d+)?)[\s]*$/);
    if (m) {
      const num = parseFloat(m[2].replace(',', '.'));
      return { baseName: m[1].trim(), qtyText: String(num), qtyNum: isNaN(num) ? undefined : num };
    }
    return { baseName: input, qtyText: '', qtyNum: undefined };
  };

  const highlight = (text, term) => {
    const t = text || '';
    const q = (term || '').trim();
    if (!q) return t;
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i === -1) return t;
    return (
      <>
        {t.slice(0, i)}
        <span className="bg-yellow-100">{t.slice(i, i + q.length)}</span>
        {t.slice(i + q.length)}
      </>
    );
  };

  const getExistingCount = (name) => {
    const nm = normalizeText(name);
    const matched = items.filter(i => normalizeText(i.name) === nm);
    if (matched.length === 0) return 0;
    let sum = 0;
    let allNumeric = true;
    matched.forEach(i => {
      const n = parseFloat((i.quantity || '').toString().replace(',', '.'));
      if (isNaN(n)) allNumeric = false; else sum += n;
    });
    return allNumeric ? (sum || matched.length) : matched.length;
  };
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [expandedDepts, setExpandedDepts] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [showShare, setShowShare] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [showAuthors, setShowAuthors] = useState(true);
  const [showNotifications, setShowNotifications] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [movingItem, setMovingItem] = useState(null);
  const [showDepartmentPicker, setShowDepartmentPicker] = useState(false);
  const [showNewDepartment, setShowNewDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');
  const [intentions, setIntentions] = useState([]);
  const [intentionsMap, setIntentionsMap] = useState({});
  const [profilesMap, setProfilesMap] = useState({});
  const [currentUserId, setCurrentUserId] = useState(null);
  const [bestPrices, setBestPrices] = useState({});
  const [myStoreId, setMyStoreId] = useState('');
  const [filterMyStore, setFilterMyStore] = useState(false);
  const [nickname, setNickname] = useState('');
  const [toasts, setToasts] = useState([]);
  const [pendingOps, setPendingOps] = useState(0);
  const [presenceMap, setPresenceMap] = useState({});
  const [listMembersMap, setListMembersMap] = useState({}); // {listId: [{user_id, nickname}]}
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTargetList, setDeleteTargetList] = useState(null);
  const [newOwnerId, setNewOwnerId] = useState('');

  const addToast = (message) => {
    if (!showNotifications) return;
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  // Проверка авторизации
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setCurrentUserId(session?.user?.id ?? null);
      setLoading(false);
      if (session?.user?.id) {
        loadUserSettings(session.user.id);
        loadProfile(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setCurrentUserId(session?.user?.id ?? null);
      if (session?.user?.id) {
        loadUserSettings(session.user.id);
        loadProfile(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Загрузка ключа Claude
  useEffect(() => {
    const saved = localStorage.getItem('claudeApiKey');
    if (saved) setClaudeApiKey(saved);
  }, []);

  // Загрузка магазинов
  useEffect(() => {
    if (user) {
      loadStores(); // теперь – списки
      loadShops();  // справочник магазинов
    }
  }, [user]);

  // Подтягиваем участников для всех видимых списков
  useEffect(() => {
    const fetchMembers = async () => {
      try {
        if (!stores || stores.length === 0) {
          setListMembersMap({});
          return;
        }
        const ids = stores.map(s => s.id);
        const map = await fetchMembersForLists(ids);
        setListMembersMap(map);
      } catch (e) {
        // мягко игнорируем
      }
    };
    fetchMembers();
  }, [stores]);

  // Загрузка каталога при переходе на экран
  useEffect(() => {
    if (currentView === 'catalog') {
      syncCatalogFromLists().then(async () => {
        await loadCatalog();
        await loadAllCatalogPrices();
      });
    }
  }, [currentView]);

  // Загрузка правил сортировки под выбранный магазин контекста
  useEffect(() => {
    if (myStoreId) {
      loadSortingRules();
    } else {
      setSortingRules({});
    }
  }, [myStoreId]);

  // Загрузка товаров через TanStack Query
  const { itemsQuery, addItem: addItemMutation, toggleChecked: toggleCheckedMutation, deleteItem: deleteItemMutation } = useListItems(currentList?.id);
  useEffect(() => {
    const apply = async () => {
      if (!itemsQuery.data) return;
      const list = itemsQuery.data;
      try {
        const map = await mapDisplayNamesForItems(list.map(i => i.name));
        setItems(list.map(i => ({ ...i, display_name: map[i.name] || null })));
      } catch {
        setItems(list);
      }
    };
    apply();
  }, [itemsQuery.data]);

  // Presence: сохраняем "мой магазин" для текущего списка
  useEffect(() => {
    const upsertPresence = async () => {
      if (!currentList?.id || !currentUserId) return;
      // Пустой выбор — удаляем запись
      if (!myStoreId) {
        await supabase.from('list_presence').delete().eq('list_id', currentList.id).eq('user_id', currentUserId);
        return;
      }
      await supabase
        .from('list_presence')
        .upsert({ list_id: currentList.id, user_id: currentUserId, store_id: myStoreId });
    };
    upsertPresence();
  }, [myStoreId, currentList?.id, currentUserId]);

  // Загрузка намерений для текущих товаров
  useEffect(() => {
    if (items && items.length > 0) {
      loadIntentionsForItems();
      loadBestPrices();
    } else {
      setIntentions([]);
      setIntentionsMap({});
      setProfilesMap({});
      setBestPrices({});
    }
  }, [items]);

  // Realtime подписки
  useEffect(() => {
    if (!user) return;

    const storesChannel = supabase
      .channel('stores-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores' }, () => {
        loadStores();
      })
      .subscribe();

    return () => {
      storesChannel.unsubscribe();
    };
  }, [user]);

  // Realtime: мои списки как владелец (shopping_lists)
  useEffect(() => {
    if (!currentUserId) return;
    const ch = supabase
      .channel('rt-shopping-lists-owner')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'shopping_lists',
        filter: `owner_id=eq.${currentUserId}`,
      }, async (payload) => {
        const { eventType, new: rowNew, old: rowOld } = payload;
        setStores(prev => {
          if (eventType === 'INSERT') {
            if (prev.some(s => s.id === rowNew.id)) return prev;
            return [{ id: rowNew.id, name: rowNew.name, created_at: rowNew.created_at, owner_id: rowNew.owner_id }, ...prev];
          }
          if (eventType === 'UPDATE') {
            return prev.map(s => s.id === rowNew.id ? { ...s, ...rowNew } : s);
          }
          if (eventType === 'DELETE') {
            return prev.filter(s => s.id !== rowOld.id);
          }
          return prev;
        });
      })
      .subscribe();
    return () => ch.unsubscribe();
  }, [currentUserId]);

  // Realtime: меня добавили/удалили из списка (list_members)
  useEffect(() => {
    if (!currentUserId) return;
    const ch = supabase
      .channel('rt-list-members-self')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'list_members',
        filter: `user_id=eq.${currentUserId}`,
      }, async (payload) => {
        const { eventType, new: rowNew, old: rowOld } = payload;
        if (eventType === 'INSERT') {
          const { data: s } = await supabase
            .from('shopping_lists')
            .select('id, name, created_at, owner_id')
            .eq('id', rowNew.list_id)
            .single();
          if (s) setStores(prev => (prev.some(x => x.id === s.id) ? prev : [s, ...prev]));
        }
        if (eventType === 'DELETE') {
          setStores(prev => prev.filter(s => s.id !== rowOld.list_id));
        }
      })
      .subscribe();
    return () => ch.unsubscribe();
  }, [currentUserId]);

  // Realtime: изменения состава участников для видимых списков (чипы на экране "Мои списки")
  useEffect(() => {
    if (!stores || stores.length === 0) return;
    const visibleIds = new Set(stores.map(s => s.id));
    const ch = supabase
      .channel('rt-list-members-visible')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'list_members',
      }, async (payload) => {
        const { eventType, new: rowNew, old: rowOld } = payload;
        if (eventType === 'INSERT') {
          if (!visibleIds.has(rowNew.list_id)) return;
          // получить ник, если его нет
          let nickname = '';
          try {
            const { data: p } = await supabase
              .from('profiles')
              .select('nickname')
              .eq('user_id', rowNew.user_id)
              .single();
            nickname = p?.nickname || 'Участник';
          } catch (_) { nickname = 'Участник'; }
          setListMembersMap(prev => {
            const copy = { ...prev };
            const arr = copy[rowNew.list_id] ? [...copy[rowNew.list_id]] : [];
            if (!arr.some(m => m.user_id === rowNew.user_id)) arr.push({ user_id: rowNew.user_id, nickname });
            copy[rowNew.list_id] = arr;
            return copy;
          });
        }
        if (eventType === 'DELETE') {
          if (!visibleIds.has(rowOld.list_id)) return;
          setListMembersMap(prev => {
            const copy = { ...prev };
            copy[rowOld.list_id] = (copy[rowOld.list_id] || []).filter(m => m.user_id !== rowOld.user_id);
            return copy;
          });
        }
      })
      .subscribe();
    return () => ch.unsubscribe();
  }, [stores]);

  useEffect(() => {
    if (!currentStore) return;

    const listsChannel = supabase
      .channel('lists-changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'lists',
        filter: `store_id=eq.${currentStore.id}`
      }, () => {
        loadLists();
      })
      .subscribe();

    return () => {
      listsChannel.unsubscribe();
    };
  }, [currentStore]);

  useEffect(() => {
    if (!currentList) return;

    const itemsChannel = supabase
      .channel('items-changes')
      .on('postgres_changes', { 
        event: '*', 
        schema: 'public', 
        table: 'list_items',
        filter: `list_id=eq.${currentList.id}`
      }, (payload) => {
        const { eventType, new: newRow, old } = payload;
        setItems(prev => {
          if (eventType === 'INSERT') {
            if (prev.some(i => i.id === newRow.id)) return prev;
            return [...prev, newRow].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
          }
          if (eventType === 'UPDATE') {
            if (newRow.checked && !old.checked) {
              addToast(`Куплено: ${newRow.name}`);
            }
            return prev.map(i => i.id === newRow.id ? { ...i, ...newRow } : i);
          }
          if (eventType === 'DELETE') {
            return prev.filter(i => i.id !== old.id);
          }
          return prev;
        });
      })
      .subscribe();

    return () => {
      itemsChannel.unsubscribe();
    };
  }, [currentList]);

  // Realtime для намерений
  const intentionsReloadTimer = useRef(null);
  useEffect(() => {
    if (!currentList) return;

    const intentionsChannel = supabase
      .channel('intentions-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'item_intentions',
      }, async (payload) => {
        // debounce обновления намерений
        if (intentionsReloadTimer.current) clearTimeout(intentionsReloadTimer.current);
        intentionsReloadTimer.current = setTimeout(() => {
          loadIntentionsForItems();
        }, 200);
        if (payload.eventType === 'INSERT') {
          const uid = payload.new?.user_id;
          if (uid && uid !== currentUserId) {
            const userNick = profilesMap[uid] || 'Участник';
            addToast(`${userNick} берёт: ${items.find(i => i.id === payload.new.list_item_id)?.name || 'товар'}`);
          }
        }
      })
      .subscribe();

    return () => {
      intentionsChannel.unsubscribe();
    };
  }, [currentList, items]);

  // Realtime presence (кратко: собираем, кто в каком магазине)
  useEffect(() => {
    if (!currentList) return;
    const channel = supabase
      .channel('presence-changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'list_presence',
        filter: `list_id=eq.${currentList.id}`,
      }, async () => {
        const { data } = await supabase
          .from('list_presence')
          .select('store_id, user_id')
          .eq('list_id', currentList.id);
        const map = {};
        (data || []).forEach(r => {
          if (!r.store_id) return;
          map[r.store_id] = (map[r.store_id] || 0) + 1;
        });
        setPresenceMap(map);
      })
      .subscribe();
    return () => channel.unsubscribe();
  }, [currentList]);

  const loadStores = async () => {
    // list-first: показываем списки пользователя
    const { data, error } = await supabase
      .from('shopping_lists')
      .select('id, name, created_at, owner_id')
      .order('created_at', { ascending: false });
    if (!error && data) setStores(data);
  };

  const loadShops = async () => {
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (!error && data) setShops(data);
  };

  const loadUserSettings = async (uid) => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('show_authors, show_notifications')
        .eq('user_id', uid)
        .single();
      if (!error && data) {
        setShowAuthors(Boolean(data.show_authors));
        if (data.show_notifications !== null && data.show_notifications !== undefined) {
          setShowNotifications(Boolean(data.show_notifications));
        }
      }
    } catch {}
  };

  const saveUserSettings = async () => {
    try {
      if (!currentUserId) return;
      await supabase
        .from('user_settings')
        .upsert({ user_id: currentUserId, show_authors: showAuthors, show_notifications: showNotifications });
      if (nickname.trim()) {
        await supabase
          .from('profiles')
          .upsert({ user_id: currentUserId, nickname: nickname.trim() });
      }
      setShowSettings(false);
    } catch (e) {
      alert(e.message || 'Не удалось сохранить настройки');
    }
  };

  const loadProfile = async (uid) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('nickname')
        .eq('user_id', uid)
        .single();
      if (!error && data) setNickname(data.nickname || '');
    } catch {}
  };

  const loadBestPrices = async () => {
    try {
      const names = items.map(i => i.name);
      const map = await fetchBestPricesForItemNames(names);
      setBestPrices(map);
    } catch (e) {
      console.error('Failed to load best prices:', e);
    }
  };

  // Удалён старый модальный редактор цен и связанные функции/состояния

  const loadLists = async () => {
    const { data, error } = await supabase
      .from('lists')
      .select('*')
      .eq('store_id', currentStore.id)
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      setLists(data);
    }
  };

  const loadItems = async () => {};

  const isUuid = (s) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s || '');

  const loadIntentionsForItems = async () => {
    try {
      const ids = items.map(i => i.id).filter(isUuid);
      if (ids.length === 0) {
        setIntentions([]);
        setIntentionsMap({});
        return;
      }
      const { data: intents, error } = await supabase
        .from('item_intentions')
        .select('*')
        .in('list_item_id', ids);
      if (error) throw error;
      setIntentions(intents);
      const map = {};
      intents.forEach(it => { map[it.list_item_id] = it; });
      setIntentionsMap(map);
      const userIds = Array.from(new Set(intents.map(i => i.user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles, error: pErr } = await supabase
          .from('profiles')
          .select('*')
          .in('user_id', userIds);
        if (pErr) throw pErr;
        const pMap = {};
        profiles.forEach(p => { pMap[p.user_id] = p.nickname; });
        setProfilesMap(pMap);
      } else {
        setProfilesMap({});
      }
    } catch (e) {
      console.error('Failed to load intentions:', e);
    }
  };

  const loadSortingRules = async () => {
    if (!myStoreId) return;
    const { data, error } = await supabase
      .from('sorting_rules')
      .select('*')
      .eq('store_id', myStoreId);
    if (!error && data) {
      const rules = {};
      data.forEach(rule => { rules[rule.item_name_normalized] = rule.department; });
      setSortingRules(rules);
    }
  };

  const signIn = async () => {
    const { error } = isSignUp 
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      alert(error.message);
    } else {
      if (isSignUp) {
        alert('Проверьте email для подтверждения!');
      }
    }
  };

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
    });
    if (error) alert(error.message);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setCurrentView('stores');
    setCurrentStore(null);
    setCurrentList(null);
  };

  const categorizeItem = async (itemName) => {
    const normalizedName = itemName.toLowerCase().trim();
    
    if (sortingRules[normalizedName]) {
      return sortingRules[normalizedName];
    }

    if (claudeApiKey) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 100,
            messages: [{
              role: "user",
              content: `Определи отдел супермаркета для товара "${itemName}". Ответь ТОЛЬКО названием отдела.`
            }]
          })
        });
        const data = await response.json();
        return data.content[0].text.trim();
      } catch (error) {
        console.error('AI categorization failed:', error);
      }
    }

    const lowerName = itemName.toLowerCase();
    for (const [category, keywords] of Object.entries(FALLBACK_CATEGORIES)) {
      if (keywords.some(keyword => lowerName.includes(keyword))) {
        return category;
      }
    }
    return 'Разное';
  };

  const addItem = async (overrideName) => {
    const { baseName, qtyText } = parseNameAndQuantity(overrideName ?? newItemName);
    const nameToAdd = baseName.trim();
    if (!nameToAdd || !currentList) return;

    // Если товар уже есть в списке — увеличиваем количество на 1 (или ставим 1, если пусто)
    const normalizeLocal = (s) => (s || '').toLowerCase().trim();
    const existing = items.find(i => normalizeLocal(i.name) === normalizeLocal(nameToAdd));
    if (existing) {
      const prevQty = parseFloat((existing.quantity || '').toString().replace(',', '.'));
      const nextQty = isNaN(prevQty) ? 1 : prevQty + 1;
      try {
        await supabase.from('list_items').update({ quantity: String(nextQty) }).eq('id', existing.id);
        setItems(prev => prev.map(it => it.id === existing.id ? { ...it, quantity: String(nextQty) } : it));
      } catch (e) {
        // офлайн — в очередь
        await enqueueOp({ entity: 'item', type: 'update_qty', id: existing.id, quantity: String(nextQty), op_id: crypto.randomUUID?.() || `${Date.now()}` });
        setPendingOps(await countPending());
        addToast('Офлайн: обновлено количество');
      }
      setNewItemName('');
      setNewItemQuantity('');
      return;
    }

    const department = await categorizeItem(nameToAdd);
    try {
      await addItemMutation.mutateAsync({ name: nameToAdd, quantity: qtyText || newItemQuantity, department });
      try { await upsertCatalogNames([nameToAdd]); } catch {}
    } catch (e) {
      await enqueueOp({ entity: 'item', type: 'add', listId: currentList.id, name: nameToAdd, quantity: qtyText || newItemQuantity, department, op_id: crypto.randomUUID?.() || `${Date.now()}` });
      setPendingOps(await countPending());
      addToast('Офлайн: товар добавлен в очередь');
    }
    setNewItemName('');
    setNewItemQuantity('');
  };

  const parseQtyNumber = (q) => {
    const num = parseFloat((q || '').toString().replace(',', '.'));
    return Number.isFinite(num) ? num : NaN;
  };

  const updateItemQuantity = async (itemId, nextQtyText) => {
    try {
      await supabase.from('list_items').update({ quantity: nextQtyText }).eq('id', itemId);
      setItems(prev => prev.map(it => it.id === itemId ? { ...it, quantity: nextQtyText } : it));
    } catch (e) {
      await enqueueOp({ entity: 'item', type: 'update_qty', id: itemId, quantity: nextQtyText, op_id: crypto.randomUUID?.() || `${Date.now()}` });
      setPendingOps(await countPending());
      addToast('Офлайн: обновлено количество');
    }
  };

  const adjustQty = async (item, delta) => {
    const current = parseQtyNumber(item.quantity);
    let next = Number.isNaN(current) ? (delta > 0 ? 1 : 1) : current + delta;
    if (next < 1) next = 1;
    await updateItemQuantity(item.id, String(next));
  };

  const claimItem = async (itemId) => {
    try {
      // оптимистично
      setIntentionsMap(prev => ({ ...prev, [itemId]: { list_item_id: itemId, user_id: currentUserId, store_id: null } }));
      await upsertIntention(itemId, null);
    } catch (e) {
      // откат
      await loadIntentionsForItems();
      alert(e.message || 'Не удалось отметить намерение');
    }
  };

  const unclaimItem = async (itemId) => {
    try {
      // оптимистично
      setIntentionsMap(prev => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
      await clearIntention(itemId);
    } catch (e) {
      // откат
      await loadIntentionsForItems();
      alert(e.message || 'Не удалось снять намерение');
    }
  };

  const toggleItem = async (itemId, checked) => {
    try {
      const item = items.find(i => i.id === itemId);
      await toggleCheckedMutation.mutateAsync({ id: itemId, checked, version: item?.version ?? 0 });
    } catch (e) {
      // офлайн/конфликт
      if ((e?.message || '').includes('Failed to fetch')) {
        const item = items.find(i => i.id === itemId);
        await enqueueOp({ entity: 'item', type: 'toggle', id: itemId, checked: !checked, baseVersion: item?.version ?? 0 });
        setPendingOps(await countPending());
        addToast('Офлайн: действие поставлено в очередь');
      } else {
        alert(e.message || 'Не удалось обновить состояние товара');
      }
    }
  };

  const deleteItem = async (itemId) => {
    try { await deleteItemMutation.mutateAsync(itemId); }
    catch (e) {
      await enqueueOp({ entity: 'item', type: 'delete', id: itemId });
      setPendingOps(await countPending());
      addToast('Офлайн: удаление в очереди');
    }
  };

  const moveItemToDepartment = async (itemId, itemName, newDept) => {
    const prev = items;
    // оптимистично
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, department: newDept } : i));
    try {
      await supabase
        .from('items')
        .update({ department: newDept })
        .eq('id', itemId);
      const normalized = itemName.toLowerCase().trim();
      if (myStoreId) {
        await supabase
          .from('sorting_rules')
          .upsert({
            store_id: myStoreId,
            item_name_normalized: normalized,
            department: newDept
          });
      }
      loadSortingRules();
    } catch (e) {
      if ((e?.message || '').includes('Failed to fetch')) {
        await enqueueOp({ entity: 'item', type: 'move', id: itemId, department: newDept });
        setPendingOps(await countPending());
        addToast('Офлайн: перенос в очереди');
      } else {
        // откат
        setItems(prev);
        alert(e.message || 'Не удалось переместить товар');
      }
    } finally {
      setShowDepartmentPicker(false);
      setMovingItem(null);
      setShowNewDepartment(false);
      setNewDepartmentName('');
    }
  };

  const createNewDepartment = () => {
    if (!newDepartmentName.trim() || !movingItem) return;
    moveItemToDepartment(movingItem.itemId, movingItem.itemName, newDepartmentName.trim());
  };

  const uncheckAll = async () => {
    await supabase
      .from('items')
      .update({ checked: false })
      .eq('list_id', currentList.id);
  };

  const addStore = async () => {
    const name = window.prompt('Название списка:');
    if (!name || !name.trim()) return;
    
    const { error } = await supabase
      .from('shopping_lists')
      .insert({ name: name.trim(), owner_id: user.id });
    if (!error) loadStores();
  };

  // CRUD магазинов
  const addShop = async () => {
    const name = window.prompt('Название магазина:');
    if (!name || !name.trim()) return;
    const { error } = await supabase.from('stores').insert({ name: name.trim(), owner_id: user.id });
    if (!error) loadShops();
  };

  // Каталог товаров
  const loadCatalog = async () => {
    try {
      setCatalog(await fetchCatalog());
    } catch (e) { console.error(e); }
  };

  // Подтягивает уникальные имена из list_items и item_prices в каталог
  const syncCatalogFromLists = async () => {
    try {
      const names = new Set();
      const { data: li } = await supabase.from('list_items').select('name');
      (li || []).forEach(r => r?.name && names.add(r.name));
      const { data: ip } = await supabase.from('item_prices').select('item_full_name, item_name_normalized');
      (ip || []).forEach(r => names.add(r.item_full_name || r.item_name_normalized));
      await upsertCatalogNames(Array.from(names));
    } catch (e) { /* мягко игнорируем */ }
  };

  const loadAllCatalogPrices = async () => {
    try {
      const pMap = {};
      const aMap = {};
      for (const item of await fetchCatalog()) {
        pMap[item.id] = await fetchPricesForCatalogItem(item.id);
        aMap[item.id] = await fetchAliases(item.id);
      }
      setCatalogPrices(pMap);
      setCatalogAliases(aMap);
    } catch (e) { console.error(e); }
  };

  const addCatalog = async () => {
    const name = window.prompt('Название товара:');
    if (!name || !name.trim()) return;
    await addCatalogItem(name);
    await loadCatalog();
    await loadAllCatalogPrices();
  };

  const renameCatalog = async (item) => {
    const name = window.prompt('Новое название товара:', item.short_name);
    if (!name || !name.trim()) return;
    await renameCatalogItem(item.id, name);
    await loadCatalog();
  };

  const deleteCatalogEntry = async (item) => {
    if (!window.confirm(`Удалить товар "${item.short_name}" из каталога?`)) return;
    await deleteCatalogItem(item.id);
    await loadCatalog();
    await loadAllCatalogPrices();
  };

  const renameShop = async (shop) => {
    const name = window.prompt('Новое название магазина:', shop.name);
    if (!name || !name.trim()) return;
    const { error } = await supabase.from('stores').update({ name: name.trim() }).eq('id', shop.id);
    if (!error) loadShops();
  };

  const deleteShop = async (shop) => {
    if (!window.confirm(`Удалить магазин "${shop.name}"?`)) return;
    const { error } = await supabase.from('stores').delete().eq('id', shop.id);
    if (!error) loadShops();
  };

  const addList = async () => {
    const name = window.prompt('Название списка:');
    if (!name || !name.trim()) return;
    
    const { error } = await supabase
      .from('lists')
      .insert({ store_id: currentStore.id, name: name.trim() });
    if (!error) loadLists();
  };

  // Присоединение к списку по коду (новая схема list-first)
  const acceptJoinCode = async () => {
    const code = joinCode.trim();
    if (!code) return;
    try {
      const { data, error } = await supabase.rpc('accept_join_code', { p_code: code });
      if (error) throw error;
      setShowJoin(false);
      setJoinCode('');
      addToast('Готово: вы присоединились к списку');
      try { await loadStores(); } catch {}
    } catch (e) {
      alert(e.message || 'Не удалось присоединиться. Проверьте код.');
    }
  };

  const openShare = async () => {
    setShowShare(true);
    setInviteCode('');
  };

  const handleGenerateInvite = async () => {
    if (!currentList?.id) return;
    try {
      const res = await generateJoinCode(currentList.id);
      const code = typeof res === 'string' ? res : (res?.code || '');
      setInviteCode(code);
      if (!code) addToast('Не удалось получить код. Попробуйте позже');
    } catch (e) {
      alert(e.message || 'Не удалось сгенерировать код');
    }
  };

  const copyInvite = async () => {
    if (!inviteCode) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      addToast('Код скопирован');
    } catch {
      window.prompt('Скопируйте код приглашения:', inviteCode);
    }
  };

  const handleLeaveList = async (listId) => {
    if (!currentUserId) return;
    if (!window.confirm('Удалить этот список у себя? Вы сможете присоединиться снова по коду.')) return;
    try {
      await removeMember(listId, currentUserId);
      // убрать из локального списка
      setStores(prev => prev.filter(l => l.id !== listId));
      setListMembersMap(prev => {
        const copy = { ...prev };
        if (copy[listId]) copy[listId] = copy[listId].filter(m => m.user_id !== currentUserId);
        return copy;
      });
      addToast('Список скрыт');
    } catch (e) {
      alert(e.message || 'Не удалось выйти из списка');
    }
  };

  const openDeleteModal = (list) => {
    setDeleteTargetList(list);
    setNewOwnerId('');
    setShowDeleteModal(true);
  };

  const confirmDeleteAction = async () => {
    const list = deleteTargetList;
    if (!list) return;
    try {
      if (list.owner_id === currentUserId) {
        // владелец
        const members = (listMembersMap[list.id] || []);
        const others = members.filter(m => m.user_id !== currentUserId);
        if (others.length === 0) {
          // один — удалить навсегда
          await deleteListEverywhere(list.id);
          setStores(prev => prev.filter(l => l.id !== list.id));
        } else if (newOwnerId) {
          await reassignOwner(list.id, newOwnerId);
          // После передачи владения выходим из участников и скрываем список у себя
          try { await removeMember(list.id, currentUserId); } catch (_) {}
          setStores(prev => prev.filter(l => l.id !== list.id));
          setListMembersMap(prev => {
            const copy = { ...prev };
            if (copy[list.id]) copy[list.id] = copy[list.id].filter(m => m.user_id !== currentUserId);
            return copy;
          });
          addToast('Владелец назначен и список скрыт у вас');
        } else {
          // удалить у всех
          await deleteListEverywhere(list.id);
          setStores(prev => prev.filter(l => l.id !== list.id));
        }
      } else {
        // чужой — выйти
        await removeMember(list.id, currentUserId);
        setStores(prev => prev.filter(l => l.id !== list.id));
      }
      setShowDeleteModal(false);
      setDeleteTargetList(null);
    } catch (e) {
      alert(e.message || 'Операция не выполнена');
    }
  };

  const handleRemoveMember = async (listId, userId) => {
    if (!window.confirm('Удалить участника из списка?')) return;
    try {
      await removeMember(listId, userId);
      setListMembersMap(prev => {
        const copy = { ...prev };
        copy[listId] = (copy[listId] || []).filter(m => m.user_id !== userId);
        return copy;
      });
      // Если удалили сами себя — обновим список доступных списков
      if (userId === currentUserId) {
        await loadStores();
      }
      addToast('Участник удален');
    } catch (e) {
      alert(e.message || 'Не удалось удалить участника');
    }
  };

  // Поиск подсказок при вводе (размещён ДО ранних return, чтобы не ломать порядок hooks)
  useEffect(() => {
    if (currentView !== 'shopping') return;
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    const term = newItemName;
    if (!term || !term.trim()) {
      setTypeaheadItems([]);
      setTypeaheadOpen(false);
      return;
    }
    typeaheadTimer.current = setTimeout(async () => {
      try {
        const list = await searchCatalogSuggestions(term, 8);
        setTypeaheadItems(list);
        setTypeaheadOpen(true);
      } catch (e) {
        // мягко игнорируем
      }
    }, 150);
    return () => typeaheadTimer.current && clearTimeout(typeaheadTimer.current);
  }, [newItemName, currentView]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-xl text-gray-600">Загрузка...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
          <h1 className="text-3xl font-bold text-center mb-6">Список покупок</h1>
          
          <button
            onClick={signInWithGoogle}
            className="w-full p-4 bg-white border-2 border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium mb-4 flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Войти через Google
          </button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-gray-500">или</span>
            </div>
          </div>

          <div className="space-y-4">
              <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && signIn()}
              placeholder="Email"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && signIn()}
              placeholder="Пароль"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={signIn}
              className="w-full p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              {isSignUp ? 'Регистрация' : 'Войти'}
            </button>
          </div>

          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="w-full mt-4 text-blue-500 hover:text-blue-600"
          >
            {isSignUp ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
          </button>
        </div>
      </div>
    );
  }

  // удалён старый normalize (замещён normalizeText)

  // Фильтр по "моему" магазину
  const filteredItems = filterMyStore && myStoreId
    ? items.filter(it => bestPrices[normalizeText(it.name)]?.store_id === myStoreId)
    : items;

  // (удалено дублирование хука)

  // Группировка товаров по отделам
  const departments = {};
  filteredItems.forEach(item => {
    if (!departments[item.department]) {
      departments[item.department] = [];
    }
    departments[item.department].push(item);
  });

  // Экран списков (list-first)
  if (currentView === 'stores') {
    const myLists = stores.filter(l => l.owner_id === currentUserId);
    const sharedLists = stores.filter(l => l.owner_id && l.owner_id !== currentUserId);
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Мои списки</h1>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentView('catalog')}
                className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
                title="Каталог товаров"
              >
                Каталог
              </button>
              <button
                onClick={() => setCurrentView('manageShops')}
                className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
                title="Мои магазины"
              >
                Магазины
              </button>
              <button 
                onClick={() => setShowSettings(true)} 
                className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
              >
                <Settings size={20} />
              </button>
              <button 
                onClick={signOut} 
                className="p-2 text-red-500 hover:bg-red-50 rounded-lg"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>

          {myLists.length > 0 && (
            <div className="mb-2 text-sm text-gray-500">Мои списки</div>
          )}
          <div className="space-y-3">
            {myLists.map(list => (
              <div key={list.id} className="p-4 bg-white rounded-lg shadow relative">
                <button
                  onClick={() => {
                    setCurrentList(list);
                    setCurrentView('shopping');
                  }}
                  className="text-left w-full pr-12"
                >
                  <div className="font-semibold text-lg">{list.name}</div>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDeleteModal(list); }}
                  className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 z-20"
                  title="Удалить / выйти"
                  aria-label="Удалить список"
                >
                  <X size={20} />
                </button>
                {/* Чипы участников */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {(listMembersMap[list.id] || []).filter(m => m.user_id !== currentUserId).map(m => (
                    <span key={m.user_id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-gray-800 text-xs">
                      {m.nickname || 'Участник'}
                      {m.user_id !== list.owner_id && (
                        <button
                          onClick={() => handleRemoveMember(list.id, m.user_id)}
                          className="ml-1 text-red-600 hover:text-red-800"
                          title="Удалить из списка"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {sharedLists.length > 0 && (
            <>
              <div className="mt-6 mb-2 text-sm text-gray-500">Со мной поделились</div>
              <div className="space-y-3">
                {sharedLists.map(list => (
                  <div key={list.id} className="p-4 bg-white rounded-lg shadow relative">
                    <button
                      onClick={() => {
                        setCurrentList(list);
                        setCurrentView('shopping');
                      }}
                      className="text-left w-full pr-12"
                    >
                      <div className="font-semibold text-lg">{list.name}</div>
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); openDeleteModal(list); }}
                      className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 z-20"
                      title="Удалить / выйти"
                      aria-label="Удалить список"
                    >
                      <X size={20} />
                    </button>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(listMembersMap[list.id] || []).filter(m => m.user_id !== currentUserId).map(m => (
                        <span key={m.user_id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-gray-800 text-xs">
                          {m.nickname || 'Участник'}
                          {m.user_id !== list.owner_id && (
                            <button
                              onClick={() => handleRemoveMember(list.id, m.user_id)}
                              className="ml-1 text-red-600 hover:text-red-800"
                              title="Удалить из списка"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <button
            onClick={addStore}
            className="w-full mt-4 p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
          >
            + Создать список
          </button>

          <button
            onClick={() => setShowJoin(true)}
            className="w-full mt-3 p-3 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium"
          >
            Присоединиться по коду
          </button>
        </div>

        {showSettings && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Настройки</h2>
                <button onClick={() => setShowSettings(false)} className="p-1">
                  <X size={24} />
                </button>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Claude API ключ (опционально)
                </label>
                <input
                  type="password"
                  value={claudeApiKey}
                  onChange={(e) => {
                    setClaudeApiKey(e.target.value);
                    localStorage.setItem('claudeApiKey', e.target.value);
                  }}
                  placeholder="sk-ant-..."
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Для AI-сортировки. Без ключа используется базовая сортировка.
                </p>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-2">Мой никнейм</label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Напр.: Dan"
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <input id="showAuthors" type="checkbox" checked={showAuthors} onChange={(e) => setShowAuthors(e.target.checked)} />
                <label htmlFor="showAuthors" className="text-sm text-gray-800">Показывать авторов действий</label>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input id="showNotifications" type="checkbox" checked={showNotifications} onChange={(e) => setShowNotifications(e.target.checked)} />
                <label htmlFor="showNotifications" className="text-sm text-gray-800">Показывать уведомления</label>
              </div>

              <button
                onClick={saveUserSettings}
                className="w-full mt-6 p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Сохранить
              </button>
            </div>
          </div>
        )}

        {showJoin && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Присоединиться по коду</h2>
                <button onClick={() => setShowJoin(false)} className="p-1">
                  <X size={24} />
                </button>
              </div>
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && acceptJoinCode()}
                placeholder="Код, например: bf913941ecd5"
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                onClick={acceptJoinCode}
                disabled={!joinCode.trim()}
                className="w-full mt-4 p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Присоединиться
              </button>
            </div>
          </div>
        )}

        {showShare && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Поделиться списком</h2>
                <button onClick={() => setShowShare(false)} className="p-1">
                  <X size={24} />
                </button>
              </div>
              {inviteCode ? (
                <>
                  <div className="p-3 border rounded-lg bg-gray-50 font-mono text-center select-all">
                    {inviteCode}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button onClick={copyInvite} className="flex-1 p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Скопировать код</button>
                    <button onClick={handleGenerateInvite} className="p-3 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200">Обновить</button>
                  </div>
                </>
              ) : (
                <button onClick={handleGenerateInvite} className="w-full p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                  Сгенерировать код
                </button>
              )}
              <p className="text-xs text-gray-500 mt-3">Передайте код другу — он введет его в разделе «Присоединиться по коду».</p>
            </div>
          </div>
        )}

        {showDeleteModal && deleteTargetList && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Удаление списка</h2>
                <button onClick={() => setShowDeleteModal(false)} className="p-1"><X size={24} /></button>
              </div>

              {deleteTargetList.owner_id === currentUserId ? (
                <div className="space-y-3 text-sm">
                  {((listMembersMap[deleteTargetList.id] || []).filter(m => m.user_id !== currentUserId).length === 0) ? (
                    <>
                      <p>Список не расшарен. Удалить навсегда?</p>
                      <button onClick={confirmDeleteAction} className="w-full p-3 bg-red-500 text-white rounded-lg hover:bg-red-600">Удалить навсегда</button>
                    </>
                  ) : (
                    <>
                      <p>Список расшарен. Выберите действие:</p>
                      <div className="space-y-2">
                        <label className="block">Назначить владельца:</label>
                        <select value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)} className="w-full p-2 border rounded">
                          <option value="">— Выберите пользователя —</option>
                          {(listMembersMap[deleteTargetList.id] || []).filter(m => m.user_id !== currentUserId).map(m => (
                            <option key={m.user_id} value={m.user_id}>{m.nickname || m.user_id}</option>
                          ))}
                        </select>
                        <button onClick={confirmDeleteAction} disabled={!newOwnerId} className="w-full p-3 bg-blue-500 text-white rounded-lg disabled:bg-gray-300">Назначить владельца и удалить у меня</button>
                      </div>
                      <div className="pt-2">
                        <button onClick={() => { setNewOwnerId(''); confirmDeleteAction(); }} className="w-full p-3 bg-red-500 text-white rounded-lg hover:bg-red-600">Удалить у всех</button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <p>Выйти из участников и удалить список у себя?</p>
                  <button onClick={confirmDeleteAction} className="w-full p-3 bg-red-500 text-white rounded-lg hover:bg-red-600">Выйти и удалить у меня</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Экран списков
  if (currentView === 'lists') {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button 
              onClick={() => setCurrentView('stores')} 
              className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-2xl font-bold">{currentStore?.name}</h1>
          </div>

          <div className="space-y-3">
            {lists.map(list => (
              <button
                key={list.id}
                onClick={() => {
                  setCurrentList(list);
                  setCurrentView('shopping');
                }}
                className="w-full p-4 bg-white rounded-lg shadow hover:shadow-md text-left"
              >
                <div className="font-semibold text-lg">{list.name}</div>
              </button>
            ))}
          </div>

          <button
            onClick={addList}
            className="w-full mt-4 p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
          >
            + Создать список
          </button>
        </div>
      </div>
    );
  }

  // Экран каталога товаров (компактный список с раскрытием деталей)
  if (currentView === 'catalog') {
    const filtered = catalog.filter(c =>
      !catalogSearch.trim() || c.short_name.toLowerCase().includes(catalogSearch.toLowerCase())
    );
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <button onClick={() => setCurrentView('stores')} className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg">
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-2xl font-bold">Каталог товаров</h1>
          </div>

          <input
            type="text"
            value={catalogSearch}
            onChange={e => setCatalogSearch(e.target.value)}
            placeholder="Поиск по названию"
            className="w-full mb-3 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />

          <div className="divide-y rounded-lg shadow bg-white">
            {filtered.map(item => (
              <details key={item.id} className="p-3 group">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-medium truncate" title={item.short_name}>{item.short_name}</span>
                    <span className="text-xs text-gray-500">{item.unit || '—'}</span>
                  </div>
                  <div className="flex gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button onClick={() => renameCatalog(item)} className="text-blue-600 hover:underline text-sm">Переименовать</button>
                    <button onClick={() => deleteCatalogEntry(item)} className="text-red-600 hover:underline text-sm">Удалить</button>
                  </div>
                </summary>

                <div className="pt-3 space-y-3">
                  {/* Полное название */}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-40 text-gray-500">Полное имя</span>
                    <input
                      defaultValue={item.display_name || ''}
                      placeholder="Напр.: Пиво Warsteiner Extra..."
                      className="flex-1 p-2 border rounded"
                      onBlur={async (e) => {
                        const val = e.target.value;
                        const updated = await updateCatalogDisplayName(item.id, val);
                        if (updated) setCatalog(prev => prev.map(c => c.id === item.id ? updated : c));
                      }}
                    />
                  </div>

                  {/* Единица измерения */}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-40 text-gray-500">Единица измерения</span>
                    <select defaultValue={item.unit || ''} className="p-2 border rounded"
                      onChange={async (e) => {
                        const updated = await updateCatalogUnit(item.id, e.target.value || null);
                        if (updated) setCatalog(prev => prev.map(c => c.id === item.id ? updated : c));
                      }}>
                      <option value="">—</option>
                      <option value="шт">шт</option>
                      <option value="кг">кг</option>
                      <option value="г">г</option>
                      <option value="л">л</option>
                      <option value="мл">мл</option>
                    </select>
                  </div>

                  {/* Алиасы */}
                  <div className="text-sm">
                    <div className="text-gray-500 mb-1">Полные названия:</div>
                    <div className="flex flex-wrap gap-2">
                      {(catalogAliases[item.id] || []).map(al => (
                        <span key={al.id} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded">
                          {al.full_name}
                          <button onClick={() => deleteAlias(al.id)} className="text-red-600">×</button>
                        </span>
                      ))}
                      <button
                        onClick={async () => {
                          const full = window.prompt('Полное название товара');
                          if (!full || !full.trim()) return;
                          await addAlias(item.id, full);
                          const list = await fetchAliases(item.id);
                          setCatalogAliases(prev => ({ ...prev, [item.id]: list }));
                        }}
                        className="text-blue-600 hover:underline"
                      >+ добавить алиас</button>
                    </div>
                  </div>

                  {/* Цены по магазинам */}
                  <div className="text-sm">
                    <div className="text-gray-500 mb-1">Цены по магазинам:</div>
                    <div className="space-y-2">
                      {shops.map(s => {
                        const rec = (catalogPrices[item.id] || {})[s.id] || {};
                        let p = rec.price ?? '';
                        let q = rec.quantity ?? '';
                        return (
                          <div key={s.id} className="flex items-center gap-2">
                            <div className="w-32 truncate" title={s.name}>{s.name}</div>
                            <input defaultValue={q} placeholder="Кол-во" className="w-20 p-2 border rounded"
                              onChange={(e) => { q = e.target.value }} />
                            <input defaultValue={p} placeholder="Цена" className="w-24 p-2 border rounded"
                              onChange={(e) => { p = e.target.value }} />
                            <button
                              onClick={async () => {
                                await upsertItemPriceByCatalogId(s.id, item.id, Number(p), (q || '').trim());
                                const updated = await fetchPricesForCatalogItem(item.id);
                                setCatalogPrices(prev => ({ ...prev, [item.id]: updated }));
                              }}
                              className="px-3 py-2 bg-blue-500 text-white rounded"
                            >Сохранить</button>
                            {rec.price != null && (
                              <button
                                onClick={async () => {
                                  await deletePriceByCatalogId(s.id, item.id);
                                  const updated = await fetchPricesForCatalogItem(item.id);
                                  setCatalogPrices(prev => ({ ...prev, [item.id]: updated }));
                                }}
                                className="px-3 py-2 bg-red-500 text-white rounded"
                              >Удалить</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </details>
            ))}
          </div>

          <button
            onClick={addCatalog}
            className="w-full mt-4 p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
          >
            + Добавить товар
          </button>
        </div>
      </div>
    );
  }

  // Экран управления магазинами
  if (currentView === 'manageShops') {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <button 
              onClick={() => setCurrentView('stores')} 
              className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
            >
              <ArrowLeft size={24} />
            </button>
            <h1 className="text-2xl font-bold">Мои магазины</h1>
          </div>

          <div className="space-y-3">
            {shops.map(shop => (
              <div key={shop.id} className="flex items-center justify-between p-4 bg-white rounded-lg shadow">
                <div className="font-semibold">{shop.name}</div>
                <div className="flex gap-2">
                  <button onClick={() => renameShop(shop)} className="text-blue-600 hover:underline text-sm">Переименовать</button>
                  <button onClick={() => deleteShop(shop)} className="text-red-600 hover:underline text-sm">Удалить</button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={addShop}
            className="w-full mt-4 p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
          >
            + Добавить магазин
          </button>
        </div>
      </div>
    );
  }

  // Экран покупок
  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-md mx-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <button 
              onClick={() => { setCurrentView('stores'); setCurrentList(null); }} 
              className="text-blue-500 hover:text-blue-600 font-medium"
            >
              ← Назад
            </button>
            <h1 className="text-xl font-bold">{currentList?.name}</h1>
            <div className="flex items-center gap-2">
              {pendingOps > 0 && (
                <button
                  onClick={async () => {
                    try {
                      await syncOnce();
                      setPendingOps(await countPending());
                      addToast('Синхронизация завершена');
                    } catch (e) {
                      addToast('Не удалось синхронизировать');
                    }
                  }}
                  className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded border border-amber-200"
                  title="Синхронизировать офлайн-очередь"
                >
                  Синхронизация ({pendingOps})
                </button>
              )}
              <button
                onClick={openShare}
                className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded border border-blue-200"
              >
                Поделиться
              </button>
              <div className="w-2" />
            </div>
          </div>

          {showShare && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
              <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-xl font-bold">Поделиться списком</h2>
                  <button onClick={() => setShowShare(false)} className="p-1">
                    <X size={24} />
                  </button>
                </div>
                {inviteCode ? (
                  <>
                    <div className="p-3 border rounded-lg bg-gray-50 font-mono text-center select-all">
                      {inviteCode}
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button onClick={copyInvite} className="flex-1 p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">Скопировать код</button>
                      <button onClick={handleGenerateInvite} className="p-3 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200">Обновить</button>
                    </div>
                  </>
                ) : (
                  <button onClick={handleGenerateInvite} className="w-full p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                    Сгенерировать код
                  </button>
                )}
                <p className="text-xs text-gray-500 mt-3">Передайте код другу — он введет его в разделе «Присоединиться по коду».</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="Товар"
              className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              value={newItemQuantity}
              onChange={(e) => setNewItemQuantity(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addItem()}
              placeholder="Кол-во"
              className="w-20 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button 
              onClick={addItem} 
              className="p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
            >
              <Plus size={20} />
            </button>
          </div>

          {/* Bottom sheet подсказок */}
          {typeaheadOpen && typeaheadItems.length > 0 && (
            <div className="fixed inset-x-0 bottom-0 z-40">
              <div className="mx-auto max-w-md bg-white shadow-2xl border-t rounded-t-2xl p-2">
                {typeaheadItems.map(s => (
                  <button
                    key={s.id}
                    onClick={async () => {
                      await addItem(s.short_name);
                      setTypeaheadOpen(false);
                    }}
                    className="w-full text-left px-3 py-3 hover:bg-gray-100 rounded-lg flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{highlight(s.short_name, newItemName)}</div>
                      {s.display_name && <div className="text-xs text-gray-500 truncate">{highlight(s.display_name, newItemName)}</div>}
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      {s.unit && <span className="text-xs text-gray-500">{s.unit}</span>}
                      {getExistingCount(s.short_name) > 0 && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">в списке ×{getExistingCount(s.short_name)}</span>
                      )}
                    </div>
                  </button>
                ))}
                <button
                  onClick={() => setTypeaheadOpen(false)}
                  className="w-full py-2 text-sm text-gray-600"
                >Скрыть</button>
              </div>
            </div>
          )}

          <button
            onClick={uncheckAll}
            className="w-full mt-3 p-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium flex items-center justify-center gap-1"
          >
            <RotateCcw size={16} />
            Снять все
          </button>

          <button
            onClick={loadBestPrices}
            className="w-full mt-2 p-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors text-sm font-medium"
            title="Пересчитать рекомендации по ценам"
          >
            Оптимизировать (цены)
          </button>

          {/* Мой магазин и фильтр */}
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={myStoreId}
              onChange={(e) => setMyStoreId(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            >
              <option value="">Мой магазин не выбран</option>
              {shops.map(shop => (
                <option key={shop.id} value={shop.id}>
                  {shop.name}{presenceMap[shop.id] ? ` · ${presenceMap[shop.id]}` : ''}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 p-2 rounded-lg border border-gray-200">
              <input type="checkbox" checked={filterMyStore} onChange={(e) => setFilterMyStore(e.target.checked)} />
              Показать для моего магазина
            </label>
          </div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-3">
        {Object.keys(departments).length === 0 ? (
          <div className="text-center text-gray-500 py-12">
            Список пуст. Добавьте первый товар!
          </div>
        ) : (
          Object.entries(departments).map(([deptName, deptItems]) => (
            <div key={deptName} className="bg-white rounded-lg shadow overflow-hidden">
              <button
                onClick={() => setExpandedDepts(prev => ({ ...prev, [deptName]: !prev[deptName] }))}
                className="w-full p-4 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-800">{deptName}</span>
                  <span className="text-sm text-gray-500">({deptItems.length})</span>
                </div>
                {expandedDepts[deptName] ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
              </button>

              {expandedDepts[deptName] && (
                <div className="divide-y">
                  {deptItems.map(item => (
                    <div 
                      key={item.id} 
                      className={`p-3 flex items-center gap-3 ${item.checked ? 'bg-gray-50' : ''}`}
                    >
                      <button
                        onClick={() => toggleItem(item.id, item.checked)}
                        className={`flex-shrink-0 w-6 h-6 rounded border-2 flex items-center justify-center transition-colors ${
                          item.checked
                            ? 'bg-green-500 border-green-500'
                            : `border-gray-300 hover:border-green-500 ${item.__conflict ? 'ring-2 ring-red-400' : ''}`
                        }`}
                      >
                        {item.checked && <Check size={16} className="text-white" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className={`font-medium ${item.checked ? 'line-through text-gray-500' : 'text-gray-800'}`}>{item.name}</div>
                        {item.display_name && (
                          <div className={`text-xs ${item.checked ? 'text-gray-400' : 'text-gray-500'} truncate`}>{item.display_name}</div>
                        )}
                        {item.quantity && (
                          <div className={`text-sm ${item.checked ? 'text-gray-400' : 'text-gray-600'}`}>{item.quantity}</div>
                        )}
                        {/* Чип цены/магазина */}
                        {bestPrices[item.name.toLowerCase().trim()] && (
                          <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                              {bestPrices[item.name.toLowerCase().trim()].store_name}
                              <span className="mx-1">·</span>
                              {bestPrices[item.name.toLowerCase().trim()].price}
                            </span>
                            {myStoreId && bestPrices[item.name.toLowerCase().trim()].store_id === myStoreId && (
                              <span className="inline-flex items-center text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                Рекомендовано здесь
                              </span>
                            )}
                          </div>
                        )}
                        {item.__conflict && (
                          <div className="text-xs text-red-500 mt-1">Конфликт версии — обновите</div>
                        )}
                        {showAuthors && intentionsMap[item.id] && (
                          <div className="text-xs text-blue-500 mt-1">
                            {intentionsMap[item.id].user_id === currentUserId
                              ? 'Вы берёте этот товар'
                              : `Берёт: ${profilesMap[intentionsMap[item.id].user_id] || 'участник'}`}
                          </div>
                        )}
                      </div>

                      {!item.checked && (
                        intentionsMap[item.id]?.user_id === currentUserId ? (
                          <button
                            onClick={() => unclaimItem(item.id)}
                            className="flex-shrink-0 px-2 py-1 text-xs bg-blue-50 text-blue-600 rounded hover:bg-blue-100"
                            title="Снять намерение"
                          >
                            Снять
                          </button>
                        ) : (
                          <button
                            onClick={() => claimItem(item.id)}
                            className="flex-shrink-0 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                            title="Я возьму"
                          >
                            Я возьму
                          </button>
                        )
                      )}

                      {/* +/- количество */}
                      <div className="flex-shrink-0 flex items-center gap-1">
                        <button
                          onClick={() => adjustQty(item, -1)}
                          className="p-1 w-7 h-7 flex items-center justify-center rounded border text-gray-700 hover:bg-gray-50"
                          title="-1"
                        >
                          −
                        </button>
                        <button
                          onClick={() => adjustQty(item, +1)}
                          className="p-1 w-7 h-7 flex items-center justify-center rounded border text-gray-700 hover:bg-gray-50"
                          title="+1"
                        >
                          +
                        </button>
                      </div>

                      <button
                        onClick={() => {
                          setMovingItem({ itemId: item.id, itemName: item.name, fromDept: deptName });
                          setShowDepartmentPicker(true);
                        }}
                        className="flex-shrink-0 p-1.5 text-blue-500 hover:bg-blue-50 rounded transition-colors"
                        title="Переместить"
                      >
                        <Move size={18} />
                      </button>

                      <button
                        onClick={() => deleteItem(item.id)}
                        className="flex-shrink-0 p-1.5 text-red-500 hover:bg-red-50 rounded transition-colors"
                        title="Удалить"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Модальное окно выбора отдела */}
      {showDepartmentPicker && movingItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 max-h-[70vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Переместить в отдел</h2>
              <button onClick={() => {
                setShowDepartmentPicker(false);
                setMovingItem(null);
              }} className="p-1">
                <X size={24} />
              </button>
            </div>
            
            <div className="mb-4 p-3 bg-blue-50 rounded-lg">
              <div className="text-sm text-blue-600 font-medium">
                {movingItem.itemName}
              </div>
              <div className="text-xs text-blue-500 mt-1">
                Текущий отдел: {movingItem.fromDept}
              </div>
            </div>

            <div className="space-y-2 mb-4">
              {Object.keys(departments)
                .filter(dept => dept !== movingItem.fromDept)
                .map(dept => (
                  <button
                    key={dept}
                    onClick={() => moveItemToDepartment(movingItem.itemId, movingItem.itemName, dept)}
                    className="w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-left font-medium"
                  >
                    {dept}
                  </button>
                ))
              }
              
              {Object.keys(FALLBACK_CATEGORIES)
                .filter(dept => !Object.keys(departments).includes(dept) && dept !== movingItem.fromDept)
                .map(dept => (
                  <button
                    key={dept}
                    onClick={() => moveItemToDepartment(movingItem.itemId, movingItem.itemName, dept)}
                    className="w-full p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-left text-gray-600"
                  >
                    {dept}
                  </button>
                ))
              }
            </div>

            <button
              onClick={() => setShowNewDepartment(true)}
              className="w-full p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors font-medium"
            >
              + Создать новый отдел
            </button>
          </div>
        </div>
      )}

      {showDeleteModal && deleteTargetList && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Удаление списка</h2>
              <button onClick={() => setShowDeleteModal(false)} className="p-1"><X size={24} /></button>
            </div>

            {deleteTargetList.owner_id === currentUserId ? (
              <div className="space-y-3 text-sm">
                {((listMembersMap[deleteTargetList.id] || []).filter(m => m.user_id !== currentUserId).length === 0) ? (
                  <>
                    <p>Список не расшарен. Удалить навсегда?</p>
                    <button onClick={confirmDeleteAction} className="w-full p-3 bg-red-500 text-white rounded-lg hover:bg-red-600">Удалить навсегда</button>
                  </>
                ) : (
                  <>
                    <p>Список расшарен. Выберите действие:</p>
                    <div className="space-y-2">
                      <label className="block">Назначить владельца:</label>
                      <select value={newOwnerId} onChange={e => setNewOwnerId(e.target.value)} className="w-full p-2 border rounded">
                        <option value="">— Выберите пользователя —</option>
                        {(listMembersMap[deleteTargetList.id] || []).filter(m => m.user_id !== currentUserId).map(m => (
                          <option key={m.user_id} value={m.user_id}>{m.nickname || m.user_id}</option>
                        ))}
                      </select>
                      <button onClick={confirmDeleteAction} disabled={!newOwnerId} className="w-full p-3 bg-blue-500 text-white rounded-lg disabled:bg-gray-300">Назначить владельца</button>
                    </div>
                    <div className="pt-2">
                      <button onClick={() => { setNewOwnerId(''); confirmDeleteAction(); }} className="w-full p-3 bg-red-500 text-white rounded-lg hover:bg-red-600">Удалить у всех</button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <p>Выйти из участников и удалить список у себя?</p>
                <button onClick={confirmDeleteAction} className="w-full p-3 bg-red-500 text-white rounded-lg hover:bg-red-600">Выйти и удалить у меня</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Модальное окно создания нового отдела */}
      {showNewDepartment && movingItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Новый отдел</h2>
              <button onClick={() => {
                setShowNewDepartment(false);
                setNewDepartmentName('');
              }} className="p-1">
                <X size={24} />
              </button>
            </div>
            
            <input
              type="text"
              value={newDepartmentName}
              onChange={(e) => setNewDepartmentName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createNewDepartment()}
              placeholder="Название отдела"
              autoFocus
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
            />

            <button
              onClick={createNewDepartment}
              disabled={!newDepartmentName.trim()}
              className="w-full p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              Создать и переместить
            </button>
          </div>
        </div>
      )}

      {/* Удалён устаревший модальный редактор цен */}
    </div>
  );
}

export default App;
