import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Plus, Settings, ChevronDown, ChevronUp, Check, X, Trash2, RotateCcw, ArrowLeft, Move, LogOut } from 'lucide-react';

// Инициализация Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
  const [currentStore, setCurrentStore] = useState(null);
  const [currentList, setCurrentList] = useState(null);
  const [lists, setLists] = useState([]);
  const [items, setItems] = useState([]);
  const [sortingRules, setSortingRules] = useState({});
  const [newItemName, setNewItemName] = useState('');
  const [newItemQuantity, setNewItemQuantity] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [expandedDepts, setExpandedDepts] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [movingItem, setMovingItem] = useState(null);
  const [showDepartmentPicker, setShowDepartmentPicker] = useState(false);
  const [showNewDepartment, setShowNewDepartment] = useState(false);
  const [newDepartmentName, setNewDepartmentName] = useState('');

  // Проверка авторизации
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
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
      loadStores();
    }
  }, [user]);

  // Загрузка списков
  useEffect(() => {
    if (currentStore) {
      loadLists();
      loadSortingRules();
    }
  }, [currentStore]);

  // Загрузка товаров
  useEffect(() => {
    if (currentList) {
      loadItems();
    }
  }, [currentList]);

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
        table: 'items',
        filter: `list_id=eq.${currentList.id}`
      }, () => {
        loadItems();
      })
      .subscribe();

    return () => {
      itemsChannel.unsubscribe();
    };
  }, [currentList]);

  const loadStores = async () => {
    const { data, error } = await supabase
      .from('stores')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (!error && data) {
      setStores(data);
    }
  };

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

  const loadItems = async () => {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('list_id', currentList.id)
      .order('created_at', { ascending: true });
    
    if (!error && data) {
      setItems(data);
    }
  };

  const loadSortingRules = async () => {
    const { data, error } = await supabase
      .from('sorting_rules')
      .select('*')
      .eq('store_id', currentStore.id);
    
    if (!error && data) {
      const rules = {};
      data.forEach(rule => {
        rules[rule.item_name_normalized] = rule.department;
      });
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

  const addItem = async () => {
    if (!newItemName.trim() || !currentList) return;

    const department = await categorizeItem(newItemName);
    const { error } = await supabase
      .from('items')
      .insert({
        list_id: currentList.id,
        name: newItemName.trim(),
        quantity: newItemQuantity.trim(),
        department
      });

    if (!error) {
      setNewItemName('');
      setNewItemQuantity('');
    }
  };

  const toggleItem = async (itemId, checked) => {
    await supabase
      .from('items')
      .update({ checked: !checked })
      .eq('id', itemId);
  };

  const deleteItem = async (itemId) => {
    await supabase.from('items').delete().eq('id', itemId);
  };

  const moveItemToDepartment = async (itemId, itemName, newDept) => {
    await supabase
      .from('items')
      .update({ department: newDept })
      .eq('id', itemId);
    
    const normalized = itemName.toLowerCase().trim();
    await supabase
      .from('sorting_rules')
      .upsert({
        store_id: currentStore.id,
        item_name_normalized: normalized,
        department: newDept
      });
    
    loadSortingRules();
    setShowDepartmentPicker(false);
    setMovingItem(null);
    setShowNewDepartment(false);
    setNewDepartmentName('');
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
    const name = window.prompt('Название магазина:');
    if (!name || !name.trim()) return;
    
    const { error } = await supabase
      .from('stores')
      .insert({ name: name.trim(), owner_id: user.id });
    if (!error) loadStores();
  };

  const addList = async () => {
    const name = window.prompt('Название списка:');
    if (!name || !name.trim()) return;
    
    const { error } = await supabase
      .from('lists')
      .insert({ store_id: currentStore.id, name: name.trim() });
    if (!error) loadLists();
  };

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
              onKeyPress={(e) => e.key === 'Enter' && signIn()}
              placeholder="Email"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && signIn()}
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

  // Группировка товаров по отделам
  const departments = {};
  items.forEach(item => {
    if (!departments[item.department]) {
      departments[item.department] = [];
    }
    departments[item.department].push(item);
  });

  // Экран магазинов
  if (currentView === 'stores') {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-md mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Мои магазины</h1>
            <div className="flex gap-2">
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

          <div className="space-y-3">
            {stores.map(store => (
              <button
                key={store.id}
                onClick={() => {
                  setCurrentStore(store);
                  setCurrentView('lists');
                }}
                className="w-full p-4 bg-white rounded-lg shadow hover:shadow-md transition-shadow text-left"
              >
                <div className="font-semibold text-lg">{store.name}</div>
              </button>
            ))}
          </div>

          <button
            onClick={addStore}
            className="w-full mt-4 p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-semibold"
          >
            + Добавить магазин
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
              </div>

              <button
                onClick={() => setShowSettings(false)}
                className="w-full mt-6 p-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
              >
                Сохранить
              </button>
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

  // Экран покупок
  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-md mx-auto p-4">
          <div className="flex items-center justify-between mb-3">
            <button 
              onClick={() => setCurrentView('lists')} 
              className="text-blue-500 hover:text-blue-600 font-medium"
            >
              ← Назад
            </button>
            <h1 className="text-xl font-bold">{currentList?.name}</h1>
            <div className="w-16"></div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addItem()}
              placeholder="Товар"
              className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <input
              type="text"
              value={newItemQuantity}
              onChange={(e) => setNewItemQuantity(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addItem()}
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

          <button
            onClick={uncheckAll}
            className="w-full mt-3 p-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium flex items-center justify-center gap-1"
          >
            <RotateCcw size={16} />
            Снять все
          </button>
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
                            : 'border-gray-300 hover:border-green-500'
                        }`}
                      >
                        {item.checked && <Check size={16} className="text-white" />}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className={`font-medium ${item.checked ? 'line-through text-gray-500' : 'text-gray-800'}`}>
                          {item.name}
                        </div>
                        {item.quantity && (
                          <div className={`text-sm ${item.checked ? 'text-gray-400' : 'text-gray-600'}`}>
                            {item.quantity}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setMovingItem({ itemId: item.id, itemName: item.name, fromDept: deptName });
                          setShowDepartmentPicker(true);
                        }}
                        className="flex-shrink-0 p-2 text-blue-500 hover:bg-blue-50 rounded transition-colors"
                        title="Переместить"
                      >
                        <Move size={18} />
                      </button>

                      <button
                        onClick={() => deleteItem(item.id)}
                        className="flex-shrink-0 p-2 text-red-500 hover:bg-red-50 rounded transition-colors"
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
              onKeyPress={(e) => e.key === 'Enter' && createNewDepartment()}
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
    </div>
  );
}

export default App;